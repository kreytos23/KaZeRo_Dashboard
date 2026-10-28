import { and, eq, inArray } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { aplicacionPago, pago, pedido, pedidoItem, saldoFavorMov } from '@/db/schema';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import {
  bloquearCliente,
  bloquearExhibidoresDe,
  bloquearPedido,
  bloquearPiezasPorId,
  liquidarSiSaldoCero,
  pagadoCentavos,
} from '@/server/pedidos/comun';
import { validarFecha } from '@/server/pedidos/servicio';
import { noAlcanza, saldoFavorDe } from '@/server/saldo-favor/servicio';
import { validarComprobante, type Comprobante } from './comprobante';
import { exigirSinDuplicados } from './duplicados';
import { METODOS_PAGO, payloadIdempotente, validarReferencia, type MetodoPago } from './servicio';

export interface DatosPagoAgrupado {
  key: string;
  adminId: string;
  vendedorId: string;
  montoCentavos: number;
  metodo: MetodoPago;
  fecha?: string;
  referencia?: string | null;
  aplicaciones: { pedidoId: string; montoCentavos: number }[];
  comprobante?: Comprobante | null;
  confirmarDuplicado?: boolean;
}

function validar(d: DatosPagoAgrupado) {
  if (!Number.isSafeInteger(d.montoCentavos) || d.montoCentavos <= 0)
    throw new ErrorNegocio('monto_invalido', 'El monto debe ser mayor que cero.', 'monto');
  if (!METODOS_PAGO.includes(d.metodo))
    throw new ErrorNegocio('metodo_invalido', 'Elige un método de pago válido.', 'metodo');
  if (d.fecha?.trim()) validarFecha(d.fecha);
  const ids = new Set<string>();
  for (const a of d.aplicaciones) {
    if (!Number.isSafeInteger(a.montoCentavos) || a.montoCentavos <= 0)
      throw new ErrorNegocio(
        'monto_invalido',
        'El monto aplicado a cada pedido debe ser mayor que cero; deja vacío el pedido que no se paga.',
        'aplicaciones',
      );
    if (ids.has(a.pedidoId))
      throw new ErrorNegocio('pedido_repetido', 'Un pedido aparece dos veces en el reparto.', 'aplicaciones');
    ids.add(a.pedidoId);
  }
  const aplicado = d.aplicaciones.reduce((s, a) => s + a.montoCentavos, 0);
  if (aplicado > d.montoCentavos)
    throw new ErrorNegocio(
      'reparto_excede',
      `Lo repartido (${formatoMXN(aplicado)}) supera el pago (${formatoMXN(d.montoCentavos)}).`,
      'aplicaciones',
    );
  // El saldo a favor se gasta completo en pedidos: no deja sobrante (lo exige también la BD).
  if (d.metodo === 'saldo_favor' && aplicado !== d.montoCentavos)
    throw new ErrorNegocio(
      'reparto_incompleto',
      'Con saldo a favor, el pago debe repartirse completo entre los pedidos.',
      'aplicaciones',
    );
  return {
    vendedorId: d.vendedorId,
    monto: d.montoCentavos,
    metodo: d.metodo,
    fecha: d.fecha?.trim() || null, // una fecha omitida se resuelve dentro de la transacción
    referencia: validarReferencia(d.referencia) ?? undefined,
    aplicaciones: [...d.aplicaciones].sort((a, b) => a.pedidoId.localeCompare(b.pedidoId)),
    aplicado,
    comprobante: validarComprobante(d.comprobante) ?? undefined,
    confirmarDuplicado: Boolean(d.confirmarDuplicado),
  };
}

/**
 * P-1/P-2: la vendedora paga de una vez varios pedidos suyos; lo que sobra queda como saldo a favor suyo.
 * Orden de bloqueo (D-10): clientas por id → pedidos por id → [exhibidores → piezas de los que se liquidan] → pago →
 * aplicaciones → libro (uso y sobrante van al final; la BD cuenta el sobrante contra el monto, 0025).
 */
export async function registrarPagoAgrupado(
  db: Ejecutor,
  d: DatosPagoAgrupado,
): Promise<{ pagoId: string; sobranteCentavos: number; liquidados: number[] }> {
  const v = validar(d);
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        {
          key: d.key,
          adminId: d.adminId,
          operacion: 'registrarPagoAgrupado',
          payload: payloadIdempotente(v),
        },
        async () => {
          await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo: null }); // la liquidación cambia `estado`
          const fecha = validarFecha(v.fecha ?? undefined);
          const ids = v.aplicaciones.map((a) => a.pedidoId);
          // cliente_id no cambia (R-27): leerlo antes de bloquear es seguro. Clientas por id, luego pedidos por id.
          const refs = ids.length
            ? await tx.select({ clienteId: pedido.clienteId }).from(pedido).where(inArray(pedido.id, ids))
            : [];
          for (const c of [...new Set(refs.map((r) => r.clienteId))].sort()) await bloquearCliente(tx, c);
          const filas: { id: string; folio: number; saldo: number }[] = [];
          for (const a of v.aplicaciones) {
            const p = await bloquearPedido(tx, a.pedidoId);
            if (p.vendedorId !== v.vendedorId)
              throw new ErrorNegocio('pedido_ajeno', 'El pedido es de otra vendedora.', 'aplicaciones');
            if (p.estado === 'liquidado')
              throw new ErrorNegocio(
                'pedido_liquidado',
                `El pedido ${formatoFolio(p.folio)} ya está liquidado.`,
                'aplicaciones',
              );
            if (p.estado === 'cancelado')
              throw new ErrorNegocio(
                'pedido_cancelado',
                `El pedido ${formatoFolio(p.folio)} está cancelado.`,
                'aplicaciones',
              );
            if (fecha < p.fecha)
              throw new ErrorNegocio(
                'fecha_invalida',
                'La fecha del pago no puede ser anterior a la del pedido.',
                'fecha',
              );
            const saldo = numericACentavos(p.total) - (await pagadoCentavos(tx, p.id));
            if (a.montoCentavos > saldo)
              throw new ErrorNegocio(
                'pago_excede',
                `Lo aplicado al pedido ${formatoFolio(p.folio)} (${formatoMXN(a.montoCentavos)}) supera su saldo (${formatoMXN(saldo)}).`,
                'aplicaciones',
              );
            filas.push({ id: p.id, folio: p.folio, saldo: saldo - a.montoCentavos });
          }
          // D-20: el saldo de la vendedora se lee con sus pedidos ya bloqueados; el libro lo vuelve a exigir.
          if (v.metodo === 'saldo_favor') {
            const disponible = numericACentavos(await saldoFavorDe(tx, { vendedorId: v.vendedorId }));
            if (v.monto > disponible) throw noAlcanza(disponible, v.monto);
          }
          // Los que se liquidan: los exhibidores de TODAS sus piezas y luego todas las piezas, ANTES de `pago`
          // (D-10, orden global; liquidarSiSaldoCero los vuelve a pedir ya tomados).
          const aLiquidar = filas.filter((f) => f.saldo === 0).map((f) => f.id);
          if (aLiquidar.length) {
            const piezaIds = (
              await tx
                .select({ piezaId: pedidoItem.piezaId })
                .from(pedidoItem)
                .where(and(inArray(pedidoItem.pedidoId, aLiquidar), eq(pedidoItem.vigente, true)))
            ).map((i) => i.piezaId);
            await bloquearExhibidoresDe(tx, piezaIds);
            await bloquearPiezasPorId(tx, piezaIds);
          }
          const [pg] = await tx
            .insert(pago)
            .values({
              idempotencyKey: d.key,
              fecha,
              monto: centavosANumeric(v.monto),
              metodo: v.metodo,
              pagadorVendedorId: v.vendedorId,
              adminId: d.adminId,
              referencia: v.referencia,
              comprobanteClave: v.comprobante?.clave ?? null,
              comprobanteSha256: v.comprobante?.sha256 ?? null,
            })
            .returning({ id: pago.id });
          await exigirSinDuplicados(tx, pg!.id, v.confirmarDuplicado); // P-4: revierte si avisa
          // R-35: la fecha de cobro de cada aplicación es la fecha del pago.
          const aps = ids.length
            ? await tx
                .insert(aplicacionPago)
                .values(
                  v.aplicaciones.map((a) => ({
                    pagoId: pg!.id,
                    pedidoId: a.pedidoId,
                    monto: centavosANumeric(a.montoCentavos),
                    fecha,
                  })),
                )
                .returning({ id: aplicacionPago.id, pedidoId: aplicacionPago.pedidoId })
            : [];
          if (v.metodo === 'saldo_favor')
            await tx.insert(saldoFavorMov).values(
              aps.map((ap) => ({
                vendedorId: v.vendedorId,
                tipo: 'uso' as const,
                monto: `-${centavosANumeric(v.aplicaciones.find((a) => a.pedidoId === ap.pedidoId)!.montoCentavos)}`,
                pedidoId: ap.pedidoId,
                aplicacionPagoId: ap.id,
                adminId: d.adminId,
                fecha,
              })),
            );
          const sobrante = v.monto - v.aplicado;
          if (sobrante > 0)
            await tx.insert(saldoFavorMov).values({
              vendedorId: v.vendedorId,
              tipo: 'sobrante',
              monto: centavosANumeric(sobrante),
              pagoId: pg!.id,
              adminId: d.adminId,
              fecha,
            });
          const liquidados: number[] = [];
          for (const f of filas)
            if ((await liquidarSiSaldoCero(tx, f.id, d.adminId)) === 'liquidado') liquidados.push(f.folio);
          return { pagoId: pg!.id, sobranteCentavos: sobrante, liquidados };
        },
      ),
    ),
  );
}
