import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { pago } from '@/db/schema';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
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

/** Sin `confirmar`, un posible duplicado detiene el guardado con la lista; con él, se guarda de todos modos. */
export async function exigirSinDuplicados(
  db: Ejecutor,
  d: Parameters<typeof posiblesDuplicados>[1],
  confirmar: boolean,
): Promise<void> {
  if (confirmar) return;
  const parecidos = await posiblesDuplicados(db, d);
  if (!parecidos.length) return;
  const lista = parecidos
    .map((p) => `${formatoMXN(p.montoCentavos)} del ${p.fecha}${p.folio ? ` (pedido #${p.folio})` : ''}`)
    .join('; ');
  throw new ErrorNegocio(
    'posible_duplicado',
    `Ya hay un pago parecido: ${lista}. Confirma si es otro pago para guardarlo.`,
    undefined,
    parecidos,
  );
}
