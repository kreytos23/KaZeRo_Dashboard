import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { devolucion, movimientoPieza, pedidoItem, pieza, saldoFavorMov } from '@/db/schema';
import { centavosANumeric, numericACentavos } from '@/domain/dinero';
import { montoDevolucion } from '@/domain/devolucion';
import { formatoFolio } from '@/domain/pedidos';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import { bloquearPedido, bloquearPiezasPorId } from '@/server/pedidos/comun';
import { validarFecha } from '@/server/pedidos/servicio';
import { saldoFavorDeCliente } from '@/server/saldo-favor/servicio';

export interface DatosDevolucion {
  key: string;
  adminId: string;
  pedidoId: string;
  itemId: string;
  motivo: string;
  fecha?: string;
}

export interface PiezaDevuelta {
  montoAFavor: string;
  saldoFavor: string;
}

const MSG_MOTIVO = 'Escribe el motivo de la devolución (hasta 200 caracteres).';
const MSG_NO_LIQUIDADO =
  'Solo se devuelven piezas de pedidos liquidados. Si el pedido está abierto, quita la pieza al editarlo.';
const MSG_FECHA = 'La fecha de la devolución no puede ser anterior a la del pedido.';

/**
 * D-12..D-19: devuelve una pieza defectuosa de un pedido LIQUIDADO. El pedido conserva total y pagos; la línea
 * pasa a `vigente = false` (libera R-05, sigue en el subtotal), la pieza `vendida → defecto` y lo pagado por esa
 * línea (precio_final menos su parte del descuento manual, P3) pasa a saldo a favor de la clienta. Sin límite de
 * días. Idempotente (`devolverPiezaDefectuosa`, atada a `<adminId>:<op>`).
 *
 * Orden de bloqueo (D-19): cliente → pedido → piezas (una `vendida` no tiene exhibidor ni custodia) → libro de
 * saldo (candado consultivo que toma el trigger al insertar). El orden de escritura importa: la devolución va
 * antes que el UPDATE de la pieza (el trigger de transición la busca) y el UPDATE antes de su movimiento.
 */
export async function devolverPiezaDefectuosa(db: Ejecutor, d: DatosDevolucion): Promise<PiezaDevuelta> {
  const motivo = d.motivo?.trim() ?? '';
  if (!motivo || motivo.length > 200) throw new ErrorNegocio('motivo_invalido', MSG_MOTIVO, 'motivo');
  if (d.fecha?.trim()) validarFecha(d.fecha);
  // Una fecha omitida se resuelve dentro de la transacción: el payload guarda lo que se pidió.
  const v = { pedidoId: d.pedidoId, itemId: d.itemId, motivo, fecha: d.fecha?.trim() || null };
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key: d.key, adminId: d.adminId, operacion: 'devolverPiezaDefectuosa', payload: v },
        async (): Promise<PiezaDevuelta> => {
          await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo });
          const fecha = validarFecha(v.fecha ?? undefined);
          const p = await bloquearPedido(tx, v.pedidoId); // cliente → pedido
          if (p.estado !== 'liquidado') throw new ErrorNegocio('pedido_no_liquidado', MSG_NO_LIQUIDADO);
          if (fecha < p.fecha) throw new ErrorNegocio('fecha_invalida', MSG_FECHA, 'fecha');
          const lineas = await tx
            .select({
              id: pedidoItem.id,
              piezaId: pedidoItem.piezaId,
              precioFinal: pedidoItem.precioFinal,
              vigente: pedidoItem.vigente,
            })
            .from(pedidoItem)
            .where(and(eq(pedidoItem.pedidoId, p.id), isNull(pedidoItem.quitadoAt)))
            .orderBy(asc(pedidoItem.id));
          const linea = lineas.find((l) => l.id === v.itemId);
          if (!linea) throw new ErrorNegocio('no_encontrado', 'La línea no es de este pedido.');
          if (!linea.vigente) throw new ErrorNegocio('ya_devuelta', 'Esa pieza ya se devolvió.');
          const [pz] = await bloquearPiezasPorId(tx, [linea.piezaId]);
          if (!pz || pz.estado !== 'vendida')
            throw new ErrorNegocio(
              'inconsistente',
              `La pieza ${pz?.codigo ?? 'de la línea'} no está vendida (${pz?.estado ?? 'no existe'}). Recarga la página.`,
            );
          const monto = montoDevolucion(
            lineas.map((l) => ({ id: l.id, precioFinal: numericACentavos(l.precioFinal) })),
            numericACentavos(p.descuentoManualMonto),
            linea.id,
          );
          // El descuento del pedido pudo cubrir todo el precio de la línea: no hay nada que devolver (sin campo).
          if (monto <= 0)
            throw new ErrorNegocio(
              'sin_monto_devolver',
              'Esta pieza no tiene monto por devolver: el descuento del pedido cubrió su precio.',
            );
          const [dv] = await tx
            .insert(devolucion)
            .values({
              pedidoItemId: linea.id,
              fecha,
              motivo,
              monto: centavosANumeric(monto),
              adminId: d.adminId,
            })
            .returning({ id: devolucion.id });
          await tx.update(pedidoItem).set({ vigente: false }).where(eq(pedidoItem.id, linea.id));
          await tx
            .update(pieza)
            .set({ estado: 'defecto', version: sql`${pieza.version} + 1` })
            .where(eq(pieza.id, pz.id));
          await tx.insert(movimientoPieza).values({
            piezaId: pz.id,
            tipo: 'devolucion',
            deEstado: 'vendida',
            aEstado: 'defecto',
            pedidoId: p.id,
            adminId: d.adminId,
            nota: `Devolución de ${formatoFolio(p.folio)}: ${motivo}`.slice(0, 200),
          });
          await tx.insert(saldoFavorMov).values({
            clienteId: p.clienteId,
            tipo: 'devolucion',
            monto: centavosANumeric(monto),
            pedidoId: p.id,
            devolucionId: dv!.id,
            adminId: d.adminId,
            fecha,
          });
          return {
            montoAFavor: centavosANumeric(monto),
            saldoFavor: await saldoFavorDeCliente(tx, p.clienteId),
          };
        },
      ),
    ),
  ).catch((e: unknown) => {
    // La BD es la última barrera: si el último movimiento de la pieza ya no es la venta de este pedido.
    if (e instanceof ErrorNegocio && e.codigo === 'pieza_transicion')
      throw new ErrorNegocio(
        'inconsistente',
        'La pieza ya no está vendida por este pedido. Recarga la página.',
      );
    throw e;
  });
}
