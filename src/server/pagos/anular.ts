import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { aplicacionPago, movimientoPieza, pago, pedido, pedidoItem, pieza, saldoFavorMov } from '@/db/schema';
import { centavosANumericConSigno, formatoMXN, numericACentavos } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio, conflictoVersion } from '@/server/errores';
import { porEntregarCentavos } from '@/server/exhibidores/lecturas-dinero';
import { conIdempotencia } from '@/server/idempotencia';
import {
  bloquearCliente,
  bloquearExhibidores,
  bloquearPedido,
  bloquearPiezasPorId,
  pagadoCentavos,
  type PedidoBloqueado,
} from '@/server/pedidos/comun';
import { saldoFavorDeCliente, saldoFavorDeVendedor } from '@/server/saldo-favor/servicio';
import {
  MSG_APLICACION_PREVIA,
  MSG_EXHIBIDOR_NEGATIVO,
  MSG_MOTIVO_ANULACION,
  MSG_YA_ANULADO,
  mensajeSobranteUsado,
} from './mensajes';

export interface DatosAnulacion {
  key: string;
  adminId: string;
  pagoId: string;
  motivo: string;
}

/**
 * P-5: deshace un pago completo (todas sus aplicaciones y su sobrante), con motivo, quién y cuándo; nada se borra.
 * Los pedidos liquidados que quedan con saldo vuelven a `abierto` y sus piezas `vendida → apartada` (las líneas
 * devueltas no: ya no son vigentes y su pieza quedó en defecto). Las comisiones ya cerradas no se tocan y el pedido no
 * se vuelve a comisionar (`comision_linea_pedido_uq`). Idempotente (`anularPago`).
 *
 * Orden de bloqueo (D-10): clientas (la pagadora y las de los pedidos) por id → pedidos por id → exhibidor que cobró
 * → piezas por id → pago FOR UPDATE → aplicaciones → libro (candado consultivo del titular, lo toma el trigger).
 * Orden de escritura (contrato de 0025): aplicaciones (`now()`), pago, libro (`anulacion`), y al final la reapertura.
 */
export async function anularPago(db: Ejecutor, d: DatosAnulacion): Promise<{ reabiertos: number[] }> {
  const motivo = d.motivo?.trim() ?? '';
  if (!motivo || motivo.length > 200)
    throw new ErrorNegocio('motivo_invalido', MSG_MOTIVO_ANULACION, 'motivo');
  const payload = { pagoId: d.pagoId, motivo };
  try {
    return await conErroresDeNegocio(() =>
      db.transaction((tx) =>
        conIdempotencia(
          tx,
          { key: d.key, adminId: d.adminId, operacion: 'anularPago', payload },
          async () => {
            await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo });
            // Para saber qué bloquear: pagador y exhibidor no cambian (0025 §2) y a un pago no se le agregan
            // aplicaciones después; lo que sí puede cambiar se vuelve a leer con el pago ya bloqueado.
            const [previo] = await tx
              .select({ clienteId: pago.pagadorClienteId, exhibidorId: pago.exhibidorId })
              .from(pago)
              .where(eq(pago.id, d.pagoId));
            if (!previo) throw new ErrorNegocio('no_encontrado', 'El pago no existe.');
            const refs = await tx
              .select({ pedidoId: aplicacionPago.pedidoId, clienteId: pedido.clienteId })
              .from(aplicacionPago)
              .innerJoin(pedido, eq(pedido.id, aplicacionPago.pedidoId))
              .where(and(eq(aplicacionPago.pagoId, d.pagoId), isNull(aplicacionPago.anuladaAt)));
            const clientes = new Set(refs.map((r) => r.clienteId));
            if (previo.clienteId) clientes.add(previo.clienteId);
            for (const c of [...clientes].sort()) await bloquearCliente(tx, c);
            const pedidos: PedidoBloqueado[] = [];
            for (const id of [...new Set(refs.map((r) => r.pedidoId))].sort())
              pedidos.push(await bloquearPedido(tx, id));
            if (previo.exhibidorId) await bloquearExhibidores(tx, [previo.exhibidorId]);
            // Una pieza vendida no tiene exhibidor (D-13): no hay más exhibidores que bloquear antes de las piezas.
            const liquidados = pedidos.filter((p) => p.estado === 'liquidado');
            const lineas = liquidados.length
              ? await tx
                  .select({ pedidoId: pedidoItem.pedidoId, piezaId: pedidoItem.piezaId })
                  .from(pedidoItem)
                  .where(
                    and(
                      inArray(
                        pedidoItem.pedidoId,
                        liquidados.map((p) => p.id),
                      ),
                      eq(pedidoItem.vigente, true),
                    ),
                  )
              : [];
            const piezas = await bloquearPiezasPorId(
              tx,
              lineas.map((l) => l.piezaId),
            );
            const [pg] = await tx
              .select({
                monto: pago.monto,
                metodo: pago.metodo,
                anuladoAt: pago.anuladoAt,
                clienteId: pago.pagadorClienteId,
                vendedorId: pago.pagadorVendedorId,
                exhibidorId: pago.exhibidorId,
              })
              .from(pago)
              .where(eq(pago.id, d.pagoId))
              .for('update');
            if (pg!.anuladoAt) throw new ErrorNegocio('pago_anulado', MSG_YA_ANULADO);
            const aps = await tx
              .select({
                id: aplicacionPago.id,
                pedidoId: aplicacionPago.pedidoId,
                anuladaAt: aplicacionPago.anuladaAt,
                estado: pedido.estado,
              })
              .from(aplicacionPago)
              .innerJoin(pedido, eq(pedido.id, aplicacionPago.pedidoId))
              .where(eq(aplicacionPago.pagoId, d.pagoId));
            // 0025 §3a: lo de un pedido cancelado ya pasó a saldo a favor; deshacer el pago lo contaría dos veces.
            if (aps.some((a) => a.anuladaAt && a.estado === 'cancelado'))
              throw new ErrorNegocio('pago_anulacion_aplicacion_previa', MSG_APLICACION_PREVIA);
            const vigentes = aps.filter((a) => !a.anuladaAt);
            if (vigentes.some((a) => !pedidos.some((p) => p.id === a.pedidoId))) throw conflictoVersion();
            // P-5: el sobrante sale del saldo del titular; si ya se usó, no alcanza.
            const [sob] = await tx
              .select({ monto: saldoFavorMov.monto })
              .from(saldoFavorMov)
              .where(and(eq(saldoFavorMov.pagoId, d.pagoId), eq(saldoFavorMov.tipo, 'sobrante')));
            const sobrante = sob ? numericACentavos(sob.monto) : 0;
            if (sobrante) {
              const saldo = numericACentavos(
                pg!.clienteId
                  ? await saldoFavorDeCliente(tx, pg!.clienteId)
                  : await saldoFavorDeVendedor(tx, pg!.vendedorId!),
              );
              if (saldo < sobrante)
                throw new ErrorNegocio(
                  'sobrante_usado',
                  mensajeSobranteUsado(formatoMXN(sobrante), formatoMXN(saldo)),
                );
            }
            // E-5: lo cobrado por el exhibidor sale de su por entregar, que no queda negativo.
            if (
              pg!.exhibidorId &&
              (await porEntregarCentavos(tx, pg!.exhibidorId)) < numericACentavos(pg!.monto)
            )
              throw new ErrorNegocio('pago_anulacion_exhibidor_negativo', MSG_EXHIBIDOR_NEGATIVO);

            if (vigentes.length)
              await tx
                .update(aplicacionPago)
                .set({ anuladaAt: sql`now()` })
                .where(
                  inArray(
                    aplicacionPago.id,
                    vigentes.map((a) => a.id),
                  ),
                );
            await tx
              .update(pago)
              .set({ anuladoAt: sql`now()`, anulacionMotivo: motivo, anuladoPor: d.adminId })
              .where(eq(pago.id, d.pagoId));
            // Con saldo a favor, lo usado vuelve a su titular; con sobrante, se quita del saldo.
            if (pg!.metodo === 'saldo_favor' || sobrante)
              await tx.insert(saldoFavorMov).values({
                clienteId: pg!.clienteId,
                vendedorId: pg!.vendedorId,
                tipo: 'anulacion',
                monto: pg!.metodo === 'saldo_favor' ? pg!.monto : centavosANumericConSigno(-sobrante),
                pagoId: d.pagoId,
                adminId: d.adminId,
                fecha: hoyMX(),
              });

            // R-16 al revés: el liquidado que queda con saldo se reabre y sus piezas vuelven a estar apartadas.
            const reabiertos: number[] = [];
            for (const p of liquidados) {
              if (numericACentavos(p.total) <= (await pagadoCentavos(tx, p.id))) continue;
              const ids = new Set(lineas.filter((l) => l.pedidoId === p.id).map((l) => l.piezaId));
              const suyas = piezas.filter((x) => ids.has(x.id));
              const noVendidas = suyas.filter((x) => x.estado !== 'vendida');
              if (noVendidas.length)
                throw new ErrorNegocio(
                  'inconsistente',
                  `Las piezas del pedido ya no están vendidas: ${noVendidas.map((x) => `${x.codigo} (${x.estado})`).join(', ')}. Recarga la página.`,
                );
              if (suyas.length) {
                await tx
                  .update(pieza)
                  .set({ estado: 'apartada', version: sql`${pieza.version} + 1` })
                  .where(inArray(pieza.id, [...ids]));
                await tx.insert(movimientoPieza).values(
                  suyas.map((x) => ({
                    piezaId: x.id,
                    tipo: 'cancelacion_venta' as const,
                    deEstado: 'vendida' as const,
                    aEstado: 'apartada' as const,
                    pedidoId: p.id,
                    adminId: d.adminId,
                    nota: `Pago deshecho: ${formatoFolio(p.folio)} vuelve a abierto.`,
                  })),
                );
              }
              await tx
                .update(pedido)
                .set({ estado: 'abierto', liquidadoAt: null, version: sql`${pedido.version} + 1` })
                .where(eq(pedido.id, p.id));
              reabiertos.push(p.folio);
            }
            return { reabiertos };
          },
        ),
      ),
    );
  } catch (e) {
    // Carrera con un uso del saldo de una vendedora (nada la bloquea antes del libro): la BD es la última barrera.
    if (e instanceof ErrorNegocio && e.codigo === 'saldo_favor_insuficiente')
      throw new ErrorNegocio('sobrante_usado', mensajeSobranteUsado());
    throw e;
  }
}
