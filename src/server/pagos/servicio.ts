import { randomUUID } from 'node:crypto';
import type { Ejecutor } from '@/db/pool';
import { aplicacionPago, pago, saldoFavorMov } from '@/db/schema';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { MSG_COBRO_SIN_SALDO_FAVOR } from '@/server/exhibidores/mensajes';
import { conIdempotencia } from '@/server/idempotencia';
import {
  bloquearExhibidorAbierto,
  bloquearPedido,
  bloquearPiezasDelPedido,
  liquidarSiSaldoCero,
  pagadoCentavos,
} from '@/server/pedidos/comun';
import { validarFecha } from '@/server/pedidos/servicio';
import { noAlcanza, saldoFavorDe } from '@/server/saldo-favor/servicio';
import { validarComprobante, type Comprobante } from './comprobante';
import { exigirSinDuplicados } from './duplicados';
import { MSG_REFERENCIA_LARGA } from './mensajes';

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
  /** Plan 4a (E-4): el exhibidor que recibió el dinero. Con él, el método no puede ser saldo a favor. */
  exhibidorId?: string | null;
  /** Plan 4b (P-4): referencia bancaria. */
  referencia?: string | null;
  /** Plan 4b (P-3): captura ya subida al almacén (la acción la sube antes). */
  comprobante?: Comprobante | null;
  /** Plan 4b (P-4): si hay un pago parecido se avisa siempre; `true` confirma que es otro pago y lo guarda. */
  confirmarDuplicado?: boolean;
  /** Solo servicios internos (cobro de una venta de exhibidor, migración): no verifica duplicados. */
  omitirAvisoDuplicado?: boolean;
}
export interface PagoRegistrado {
  pagoId: string;
  estado: 'abierto' | 'liquidado';
  saldo: string;
}

/** Referencia opcional (P-4): sin espacios sobrantes, hasta 60 caracteres; vacía → null. */
export function validarReferencia(r: string | null | undefined): string | null {
  const t = r?.trim().replace(/\s+/g, ' ') || null;
  if (t && t.length > 60) throw new ErrorNegocio('referencia_invalida', MSG_REFERENCIA_LARGA, 'referencia');
  return t;
}

function validar(d: Omit<DatosPagoPedido, 'key'>) {
  if (!Number.isSafeInteger(d.montoCentavos) || d.montoCentavos <= 0)
    throw new ErrorNegocio('monto_invalido', 'El monto debe ser mayor que cero.', 'monto');
  if (!METODOS_PAGO.includes(d.metodo))
    throw new ErrorNegocio('metodo_invalido', 'Elige un método de pago válido.', 'metodo');
  if (d.pagador !== 'cliente' && d.pagador !== 'vendedor')
    throw new ErrorNegocio('pagador_invalido', 'Elige quién paga.', 'pagador');
  if (d.exhibidorId && d.pagador !== 'cliente')
    throw new ErrorNegocio(
      'pagador_invalido',
      'Un cobro del exhibidor lo paga la clienta: elige «cliente».',
      'pagador',
    );
  if (d.exhibidorId && d.metodo === 'saldo_favor')
    throw new ErrorNegocio('metodo_invalido', MSG_COBRO_SIN_SALDO_FAVOR, 'metodo');
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
    exhibidorId: d.exhibidorId || undefined, // ausente: el hash de idempotencia de pagos sin exhibidor no cambia
    referencia: validarReferencia(d.referencia) ?? undefined,
    comprobante: validarComprobante(d.comprobante) ?? undefined,
    confirmarDuplicado: d.confirmarDuplicado || undefined, // ausente y `false` dan el mismo hash
  };
}

/**
 * Payload de idempotencia: el comprobante cuenta por su huella, no por la clave aleatoria con que se subió (I-2):
 * reenviar la misma captura con la misma `key` devuelve el resultado original (el blob repetido lo recoge el barrido).
 */
export function payloadIdempotente<T extends { comprobante?: { sha256: string } }>(v: T) {
  return { ...v, comprobante: v.comprobante?.sha256 };
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
        {
          key: d.key,
          adminId: d.adminId,
          operacion: 'registrarPagoDePedido',
          payload: payloadIdempotente(v),
        },
        () => registrarPagoEnTx(tx, d, d.key),
      ),
    ),
  );
}

/**
 * Cuerpo de `registrarPagoDePedido` dentro de una transacción ya abierta. `pagoKey` es la llave única del pago
 * (la de la solicitud, o una nueva cuando el llamador ya cubre la idempotencia de toda su operación).
 */
export async function registrarPagoEnTx(
  tx: Ejecutor,
  d: Omit<DatosPagoPedido, 'key'>,
  pagoKey: string = randomUUID(),
): Promise<PagoRegistrado> {
  const v = validar(d);
  await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo: null }); // la liquidación cambia `estado`
  const fecha = validarFecha(v.fecha ?? undefined);
  const p = await bloquearPedido(tx, v.pedidoId);
  if (p.estado === 'liquidado') throw new ErrorNegocio('pedido_liquidado', 'El pedido ya está liquidado.');
  if (p.estado === 'cancelado') throw new ErrorNegocio('pedido_cancelado', 'El pedido está cancelado.');
  // E-4: el exhibidor que cobra debe estar abierto y ser de la vendedora del pedido (la BD lo exige también).
  // Se bloquea después del pedido (D-10) y antes del pago: un cierre concurrente espera a este cobro.
  if (v.exhibidorId) {
    const ex = await bloquearExhibidorAbierto(tx, v.exhibidorId);
    if (ex.vendedorId !== p.vendedorId)
      throw new ErrorNegocio(
        'exhibidor_ajeno',
        'El exhibidor es de otra vendedora que la del pedido.',
        'exhibidorId',
      );
  }
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
  // P-2: con pagador vendedora paga con el saldo de la vendedora (su sobrante); la BD ata el uso a su titular.
  if (v.metodo === 'saldo_favor') {
    const disponible = numericACentavos(
      await saldoFavorDe(
        tx,
        v.pagador === 'cliente' ? { clienteId: p.clienteId } : { vendedorId: p.vendedorId },
      ),
    );
    if (v.monto > disponible) throw noAlcanza(disponible, v.monto);
  }
  // P-4: avisa siempre, salvo confirmación o servicio interno; el saldo a favor es dinero interno (sin banco).
  if (!d.omitirAvisoDuplicado && v.metodo !== 'saldo_favor')
    await exigirSinDuplicados(
      tx,
      {
        referencia: v.referencia,
        montoCentavos: v.monto,
        fecha,
        pagador: v.pagador === 'cliente' ? { clienteId: p.clienteId } : { vendedorId: p.vendedorId },
      },
      Boolean(v.confirmarDuplicado),
    );
  // Si el pago liquida, exhibidores → piezas ANTES de tocar `pago` (D-10).
  if (v.monto === saldo) await bloquearPiezasDelPedido(tx, p.id);
  const monto = centavosANumeric(v.monto);
  const [pg] = await tx
    .insert(pago)
    .values({
      idempotencyKey: pagoKey,
      fecha,
      monto,
      metodo: v.metodo,
      pagadorClienteId: v.pagador === 'cliente' ? p.clienteId : null,
      pagadorVendedorId: v.pagador === 'vendedor' ? p.vendedorId : null,
      nota: v.nota,
      adminId: d.adminId, // D-21: quién lo registró
      exhibidorId: v.exhibidorId ?? null,
      referencia: v.referencia,
      comprobanteClave: v.comprobante?.clave ?? null,
      comprobanteSha256: v.comprobante?.sha256 ?? null,
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
      clienteId: v.pagador === 'cliente' ? p.clienteId : null,
      vendedorId: v.pagador === 'vendedor' ? p.vendedorId : null,
      tipo: 'uso',
      monto: `-${monto}`,
      pedidoId: p.id,
      aplicacionPagoId: ap!.id,
      adminId: d.adminId,
      fecha,
    });
  const estado = (await liquidarSiSaldoCero(tx, p.id, d.adminId)) as 'abierto' | 'liquidado';
  return { pagoId: pg!.id, estado, saldo: centavosANumeric(saldo - v.monto) };
}
