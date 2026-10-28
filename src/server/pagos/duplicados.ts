import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { pago } from '@/db/schema';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';
import { ErrorNegocio } from '@/server/errores';

export interface PagoParecido {
  pagoId: string;
  /** Folio del primer pedido al que se aplicó; null si el pago no tiene aplicaciones. */
  folio: number | null;
  fecha: string;
  montoCentavos: number;
}

/**
 * P-4: pagos vigentes con la misma referencia, o con el mismo monto y fecha del mismo pagador. Solo informa:
 * quien guarda decide (`exigirSinDuplicados`). Los anulados y los pagos con saldo a favor (dinero interno) no cuentan.
 */
export async function posiblesDuplicados(
  db: Ejecutor,
  d: {
    referencia?: string | null;
    montoCentavos: number;
    fecha: string;
    pagador: { clienteId?: string; vendedorId?: string };
    /** El pago recién insertado que se revisa: no es parecido de sí mismo. */
    excluirPagoId?: string;
  },
): Promise<PagoParecido[]> {
  const referencia = d.referencia?.trim().toLowerCase();
  if (!d.pagador.clienteId && !d.pagador.vendedorId)
    throw new ErrorNegocio('pagador_invalido', 'Elige quién paga.', 'pagador');
  const pagador = d.pagador.clienteId
    ? eq(pago.pagadorClienteId, d.pagador.clienteId)
    : eq(pago.pagadorVendedorId, d.pagador.vendedorId!);
  const filas = await db
    .select({
      pagoId: pago.id,
      fecha: pago.fecha,
      monto: pago.monto,
      folio: sql<
        number | null
      >`(SELECT p.folio::int FROM aplicacion_pago a JOIN pedido p ON p.id = a.pedido_id
        WHERE a.pago_id = "pago"."id" ORDER BY a.created_at, p.folio LIMIT 1)`,
    })
    .from(pago)
    .where(
      and(
        isNull(pago.anuladoAt),
        ne(pago.metodo, 'saldo_favor'),
        d.excluirPagoId ? ne(pago.id, d.excluirPagoId) : undefined,
        or(
          and(eq(pago.monto, centavosANumeric(d.montoCentavos)), eq(pago.fecha, d.fecha), pagador),
          referencia ? sql`lower(btrim(${pago.referencia})) = ${referencia}` : undefined,
        ),
      ),
    )
    .orderBy(desc(pago.createdAt))
    .limit(5);
  return filas.map((f) => ({
    pagoId: f.pagoId,
    folio: f.folio,
    fecha: f.fecha,
    montoCentavos: numericACentavos(f.monto),
  }));
}

/**
 * P-4, único punto de la regla. Se llama con el pago ya insertado en su transacción (después de todas las
 * validaciones del servicio): sin `confirmar`, un posible duplicado detiene el guardado con la lista y la transacción
 * se revierte; con él, se guarda de todos modos. El saldo a favor es dinero interno (sin banco): no avisa. Solo lo
 * llaman las entradas públicas (`registrarPagoDePedido`, `registrarPagoAgrupado`); los servicios internos que usan
 * `registrarPagoEnTx` (cobro de una venta de exhibidor) no avisan.
 */
export async function exigirSinDuplicados(db: Ejecutor, pagoId: string, confirmar: boolean): Promise<void> {
  if (confirmar) return;
  const [p] = await db
    .select({
      metodo: pago.metodo,
      referencia: pago.referencia,
      monto: pago.monto,
      fecha: pago.fecha,
      clienteId: pago.pagadorClienteId,
      vendedorId: pago.pagadorVendedorId,
    })
    .from(pago)
    .where(eq(pago.id, pagoId));
  if (!p || p.metodo === 'saldo_favor') return;
  const parecidos = await posiblesDuplicados(db, {
    referencia: p.referencia,
    montoCentavos: numericACentavos(p.monto),
    fecha: p.fecha,
    pagador: p.clienteId ? { clienteId: p.clienteId } : { vendedorId: p.vendedorId! },
    excluirPagoId: pagoId,
  });
  if (!parecidos.length) return;
  const lista = parecidos
    .map(
      (p) =>
        `${formatoMXN(p.montoCentavos)} del ${p.fecha}${p.folio ? ` (pedido ${formatoFolio(p.folio)})` : ''}`,
    )
    .join('; ');
  throw new ErrorNegocio(
    'posible_duplicado',
    `Ya hay un pago parecido: ${lista}. Confirma si es otro pago para guardarlo.`,
    undefined,
    parecidos,
  );
}
