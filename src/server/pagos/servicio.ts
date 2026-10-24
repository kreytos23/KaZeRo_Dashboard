import type { Ejecutor } from '@/db/pool';
import { aplicacionPago, pago, saldoFavorMov } from '@/db/schema';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import {
  bloquearPedido,
  bloquearPiezasDelPedido,
  liquidarSiSaldoCero,
  pagadoCentavos,
} from '@/server/pedidos/comun';
import { validarFecha } from '@/server/pedidos/servicio';
import { noAlcanza, saldoFavorDeCliente } from '@/server/saldo-favor/servicio';

export const METODOS_PAGO = ['transferencia', 'efectivo', 'otro', 'saldo_favor'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export interface DatosPagoPedido {
  key: string;
  adminId: string;
  pedidoId: string;
  fecha?: string;
  montoCentavos: number;
  metodo: MetodoPago;
  pagador: 'cliente' | 'vendedor';
  nota?: string;
}
export interface PagoRegistrado {
  pagoId: string;
  estado: 'abierto' | 'liquidado';
  saldo: string;
}

function validar(d: DatosPagoPedido) {
  if (!Number.isSafeInteger(d.montoCentavos) || d.montoCentavos <= 0)
    throw new ErrorNegocio('monto_invalido', 'El monto debe ser mayor que cero.', 'monto');
  if (!METODOS_PAGO.includes(d.metodo))
    throw new ErrorNegocio('metodo_invalido', 'Elige un método de pago válido.', 'metodo');
  if (d.pagador !== 'cliente' && d.pagador !== 'vendedor')
    throw new ErrorNegocio('pagador_invalido', 'Elige quién paga.', 'pagador');
  // Plan 3.1 (D-20): el saldo a favor es de la clienta; con pagador vendedor no hay de dónde descontarlo.
  if (d.metodo === 'saldo_favor' && d.pagador !== 'cliente')
    throw new ErrorNegocio(
      'pagador_invalido',
      'El saldo a favor es de la clienta: elige «cliente».',
      'pagador',
    );
  if (d.fecha?.trim()) validarFecha(d.fecha);
  const nota = d.nota?.trim() || null;
  if (nota && nota.length > 200)
    throw new ErrorNegocio('nota_invalida', 'La nota admite hasta 200 caracteres.', 'nota');
  return {
    pedidoId: d.pedidoId,
    fecha: d.fecha?.trim() || null, // una fecha omitida se resuelve dentro de la transacción
    monto: d.montoCentavos,
    metodo: d.metodo,
    pagador: d.pagador,
    nota,
  };
}

/**
 * Pago mínimo del Plan 3 (D-3, P1): un pago → una aplicación a UN pedido, sin sobrante. El Plan 4 agrega
 * captura/OCR, reparto entre pedidos (R-31 a R-33) y saldo a favor por sobrante (R-34) sobre las mismas tablas.
 * Orden de bloqueo (D-10, D-24): cliente → pedido → [exhibidores → piezas, si el pago liquida] → pago → saldo.
 * Con `metodo: 'saldo_favor'` (Plan 3.1, D-20) el pago descuenta del saldo de la clienta: además de `pago` y
 * `aplicacion_pago` inserta el `uso` en el libro (la BD exige los tres a la vez al confirmar).
 */
export async function registrarPagoDePedido(db: Ejecutor, d: DatosPagoPedido): Promise<PagoRegistrado> {
  const v = validar(d);
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key: d.key, adminId: d.adminId, operacion: 'registrarPagoDePedido', payload: v },
        async (): Promise<PagoRegistrado> => {
          await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo: null }); // la liquidación cambia `estado`
          const fecha = validarFecha(v.fecha ?? undefined);
          const p = await bloquearPedido(tx, v.pedidoId);
          if (p.estado === 'liquidado')
            throw new ErrorNegocio('pedido_liquidado', 'El pedido ya está liquidado.');
          if (p.estado === 'cancelado')
            throw new ErrorNegocio('pedido_cancelado', 'El pedido está cancelado.');
          if (fecha < p.fecha)
            throw new ErrorNegocio(
              'fecha_invalida',
              'La fecha del pago no puede ser anterior a la del pedido.',
              'fecha',
            );
          const saldo = numericACentavos(p.total) - (await pagadoCentavos(tx, p.id));
          if (v.monto > saldo)
            throw new ErrorNegocio(
              'pago_excede',
              `El pago (${formatoMXN(v.monto)}) supera el saldo del pedido (${formatoMXN(saldo)}).`,
              'monto',
            );
          // D-20: el saldo se lee con cliente y pedido ya bloqueados, así que nadie más lo cambia en medio.
          if (v.metodo === 'saldo_favor') {
            const disponible = numericACentavos(await saldoFavorDeCliente(tx, p.clienteId));
            if (v.monto > disponible) throw noAlcanza(disponible, v.monto);
          }
          // Si el pago liquida, exhibidores → piezas ANTES de tocar `pago` (D-10).
          if (v.monto === saldo) await bloquearPiezasDelPedido(tx, p.id);
          const monto = centavosANumeric(v.monto);
          const [pg] = await tx
            .insert(pago)
            .values({
              idempotencyKey: d.key,
              fecha,
              monto,
              metodo: v.metodo,
              pagadorClienteId: v.pagador === 'cliente' ? p.clienteId : null,
              pagadorVendedorId: v.pagador === 'vendedor' ? p.vendedorId : null,
              nota: v.nota,
              adminId: d.adminId, // D-21: quién lo registró
            })
            .returning({ id: pago.id });
          // R-35: la fecha de cobro de la aplicación es la fecha del pago.
          const [ap] = await tx
            .insert(aplicacionPago)
            .values({ pagoId: pg!.id, pedidoId: p.id, monto, fecha })
            .returning({ id: aplicacionPago.id });
          // El `uso` va al final (D-24): toma el candado consultivo del libro con todo lo demás ya bloqueado.
          if (v.metodo === 'saldo_favor')
            await tx.insert(saldoFavorMov).values({
              clienteId: p.clienteId,
              tipo: 'uso',
              monto: `-${monto}`,
              pedidoId: p.id,
              aplicacionPagoId: ap!.id,
              adminId: d.adminId,
              fecha,
            });
          const estado = (await liquidarSiSaldoCero(tx, p.id, d.adminId)) as 'abierto' | 'liquidado';
          return { pagoId: pg!.id, estado, saldo: centavosANumeric(saldo - v.monto) };
        },
      ),
    ),
  );
}
