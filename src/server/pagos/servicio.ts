import type { Ejecutor } from '@/db/pool';
import { aplicacionPago, pago } from '@/db/schema';
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

export const METODOS_PAGO = ['transferencia', 'efectivo', 'otro'] as const;
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
  const nota = d.nota?.trim() || null;
  if (nota && nota.length > 200)
    throw new ErrorNegocio('nota_invalida', 'La nota admite hasta 200 caracteres.', 'nota');
  return {
    pedidoId: d.pedidoId,
    fecha: validarFecha(d.fecha),
    monto: d.montoCentavos,
    metodo: d.metodo,
    pagador: d.pagador,
    nota,
  };
}

/**
 * Pago mínimo del Plan 3 (D-3, P1): un pago → una aplicación a UN pedido, sin sobrante. El Plan 4 agrega
 * captura/OCR, reparto entre pedidos (R-31 a R-33) y saldo a favor por sobrante (R-34) sobre las mismas tablas.
 * Orden de bloqueo (D-10): cliente → pedido → [exhibidores → piezas, si el pago liquida] → pago.
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
          const p = await bloquearPedido(tx, v.pedidoId);
          if (p.estado === 'liquidado')
            throw new ErrorNegocio('pedido_liquidado', 'El pedido ya está liquidado.');
          if (p.estado === 'cancelado')
            throw new ErrorNegocio('pedido_cancelado', 'El pedido está cancelado.');
          const saldo = numericACentavos(p.total) - (await pagadoCentavos(tx, p.id));
          if (v.monto > saldo)
            throw new ErrorNegocio(
              'pago_excede',
              `El pago (${formatoMXN(v.monto)}) supera el saldo del pedido (${formatoMXN(saldo)}).`,
              'monto',
            );
          // Si el pago liquida, exhibidores → piezas ANTES de tocar `pago` (D-10).
          if (v.monto === saldo) await bloquearPiezasDelPedido(tx, p.id);
          const monto = centavosANumeric(v.monto);
          const [pg] = await tx
            .insert(pago)
            .values({
              idempotencyKey: d.key,
              fecha: v.fecha,
              monto,
              metodo: v.metodo,
              pagadorClienteId: v.pagador === 'cliente' ? p.clienteId : null,
              pagadorVendedorId: v.pagador === 'vendedor' ? p.vendedorId : null,
              nota: v.nota,
              adminId: d.adminId, // D-21: quién lo registró
            })
            .returning({ id: pago.id });
          // R-35: la fecha de cobro de la aplicación es la fecha del pago.
          await tx.insert(aplicacionPago).values({ pagoId: pg!.id, pedidoId: p.id, monto, fecha: v.fecha });
          const estado = (await liquidarSiSaldoCero(tx, p.id, d.adminId)) as 'abierto' | 'liquidado';
          return { pagoId: pg!.id, estado, saldo: centavosANumeric(saldo - v.monto) };
        },
      ),
    ),
  );
}
