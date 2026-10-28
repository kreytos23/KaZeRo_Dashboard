import { desc, eq, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { cliente, saldoFavorMov, vendedor, vSaldoFavor, vSaldoFavorMov } from '@/db/schema';
import { centavosANumeric, centavosANumericConSigno, formatoMXN, numericACentavos } from '@/domain/dinero';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import { validarFecha } from '@/server/pedidos/servicio';

export type MovSaldoFavor = typeof vSaldoFavorMov.$inferSelect;

/** Titular de un saldo a favor: una clienta o (Plan 4b) una vendedora. */
export type Titular = { clienteId: string } | { vendedorId: string };

/** Las dos columnas del titular (una de ellas null), como las guardan `saldo_favor_mov` y `pago`. */
export const columnasTitular = (t: Titular) => ({
  clienteId: 'clienteId' in t ? t.clienteId : null,
  vendedorId: 'vendedorId' in t ? t.vendedorId : null,
});

/** Saldo a favor vigente del titular (vista `v_saldo_favor`); '0.00' si nunca tuvo movimientos. */
export async function saldoFavorDe(db: Ejecutor, t: Titular): Promise<string> {
  const [r] = await db
    .select({ saldo: vSaldoFavor.saldo })
    .from(vSaldoFavor)
    .where(
      'clienteId' in t ? eq(vSaldoFavor.clienteId, t.clienteId) : eq(vSaldoFavor.vendedorId, t.vendedorId),
    );
  return r?.saldo ?? '0.00';
}

/**
 * Historial del libro de la clienta, el más reciente primero (D-23: es la auditoría del dinero).
 * `created_at` es el inicio de la transacción, así que las filas de una misma transacción empatan y el libro no
 * tiene columna serial. Desempate estable (documentado): primero lo que sale (retiro, uso) y luego lo que
 * entra (los demás), porque dentro de una transacción el crédito precede al gasto; luego monto mayor primero
 * y por último el id, solo para que el orden sea total y repetible.
 */
export function movimientosSaldoFavor(
  db: Ejecutor,
  d: Titular & { limite?: number },
): Promise<MovSaldoFavor[]> {
  const q = db
    .select()
    .from(vSaldoFavorMov)
    .where(
      'clienteId' in d
        ? eq(vSaldoFavorMov.clienteId, d.clienteId)
        : eq(vSaldoFavorMov.vendedorId, d.vendedorId),
    )
    .orderBy(
      desc(vSaldoFavorMov.createdAt),
      sql`CASE WHEN ${vSaldoFavorMov.tipo}::text IN ('retiro', 'uso') THEN 0 ELSE 1 END`,
      sql`abs(${vSaldoFavorMov.monto}) DESC`,
      desc(vSaldoFavorMov.id),
    );
  return d.limite ? q.limit(d.limite) : q;
}

export interface DatosRetiro {
  key: string;
  adminId: string;
  titular: Titular;
  montoCentavos: number;
  nota: string;
  fecha?: string;
}

export const noAlcanza = (disponible: number, monto: number) =>
  new ErrorNegocio(
    'saldo_insuficiente',
    `El saldo a favor (${formatoMXN(disponible)}) no alcanza para ${formatoMXN(monto)}.`,
    'monto',
  );

/** Nota obligatoria de un retiro en efectivo (D-21, P-6): sin espacios sobrantes, 1..200 caracteres. */
export function validarNotaRetiro(n: string | undefined): string {
  const nota = n?.trim() ?? '';
  if (!nota || nota.length > 200)
    throw new ErrorNegocio('nota_invalida', 'Escribe una nota del retiro (hasta 200 caracteres).', 'nota');
  return nota;
}

/**
 * Retiro en efectivo dentro de una transacción ya abierta, con el titular ya bloqueado o su saldo recién acreditado
 * en ella (D-24). Lo usan `retirarSaldoFavor` y la cancelación con reembolso (P-6). Devuelve lo que queda (centavos).
 */
export async function retirarEnTx(
  tx: Ejecutor,
  d: {
    titular: Titular;
    montoCentavos: number;
    nota: string;
    adminId: string;
    fecha: string;
    /** P-6: el pedido cancelado del reembolso, para que el historial del saldo lo muestre. */
    pedidoId?: string;
  },
): Promise<number> {
  const disponible = numericACentavos(await saldoFavorDe(tx, d.titular));
  if (d.montoCentavos > disponible) throw noAlcanza(disponible, d.montoCentavos);
  await tx.insert(saldoFavorMov).values({
    ...columnasTitular(d.titular),
    tipo: 'retiro',
    monto: centavosANumericConSigno(-d.montoCentavos),
    nota: d.nota,
    pedidoId: d.pedidoId ?? null,
    adminId: d.adminId,
    fecha: d.fecha,
  });
  return disponible - d.montoCentavos;
}

/** Bloquea la fila del titular (NO KEY UPDATE, D-24); si no existe, lo dice. */
async function bloquearTitular(tx: Ejecutor, t: Titular): Promise<void> {
  const [f] =
    'clienteId' in t
      ? await tx
          .select({ id: cliente.id })
          .from(cliente)
          .where(eq(cliente.id, t.clienteId))
          .for('no key update')
      : await tx
          .select({ id: vendedor.id })
          .from(vendedor)
          .where(eq(vendedor.id, t.vendedorId))
          .for('no key update');
  if (!f)
    throw new ErrorNegocio(
      'no_encontrado',
      'clienteId' in t ? 'La clienta no existe.' : 'La vendedora no existe.',
    );
}

/**
 * D-21 / P-2: el titular (clienta o vendedora) retira su saldo a favor en efectivo. Idempotente: la operación
 * conserva su nombre de siempre por titular (`retirarSaldoFavor` / `retirarSaldoFavorDeVendedor`) para no invalidar
 * llaves ya guardadas. Orden de bloqueo (D-24): titular (NO KEY UPDATE) → candado consultivo del libro (lo toma el
 * trigger al insertar). El saldo se lee con el titular ya bloqueado: ningún otro escritor de su saldo lo cambia en medio.
 */
export async function retirarSaldoFavor(db: Ejecutor, d: DatosRetiro): Promise<{ saldo: string }> {
  if (!Number.isSafeInteger(d.montoCentavos) || d.montoCentavos <= 0)
    throw new ErrorNegocio('monto_invalido', 'El monto debe ser mayor que cero.', 'monto');
  const nota = validarNotaRetiro(d.nota);
  if (d.fecha?.trim()) validarFecha(d.fecha);
  const payload = {
    ...d.titular,
    monto: d.montoCentavos,
    nota,
    fecha: d.fecha?.trim() || null, // una fecha omitida se resuelve dentro de la transacción
  };
  const operacion = 'clienteId' in d.titular ? 'retirarSaldoFavor' : 'retirarSaldoFavorDeVendedor';
  return conSaldoInsuficienteLegible(db, d, () =>
    conErroresDeNegocio(() =>
      db.transaction((tx) =>
        conIdempotencia(
          tx,
          { key: d.key, adminId: d.adminId, operacion, payload },
          async (): Promise<{ saldo: string }> => {
            await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo: null });
            const fecha = validarFecha(payload.fecha ?? undefined);
            await bloquearTitular(tx, d.titular);
            const queda = await retirarEnTx(tx, {
              titular: d.titular,
              montoCentavos: d.montoCentavos,
              nota,
              adminId: d.adminId,
              fecha,
            });
            return { saldo: centavosANumeric(queda) };
          },
        ),
      ),
    ),
  );
}

/**
 * Carrera que el bloqueo del titular ya evita: si la BD igual rechaza con `saldo_favor_insuficiente`, se
 * traduce al mismo mensaje con el saldo real (leído fuera de la transacción que se revirtió).
 */
export async function conSaldoInsuficienteLegible<T>(
  db: Ejecutor,
  d: { titular: Titular; montoCentavos: number },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErrorNegocio && e.codigo === 'saldo_favor_insuficiente')
      throw noAlcanza(numericACentavos(await saldoFavorDe(db, d.titular)), d.montoCentavos);
    throw e;
  }
}
