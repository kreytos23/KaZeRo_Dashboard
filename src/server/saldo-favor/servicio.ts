import { desc, eq, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { cliente, saldoFavorMov, vSaldoFavor, vSaldoFavorMov } from '@/db/schema';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import { validarFecha } from '@/server/pedidos/servicio';

export type MovSaldoFavor = typeof vSaldoFavorMov.$inferSelect;

/** Saldo a favor vigente de la clienta (vista `v_saldo_favor`); '0.00' si nunca tuvo movimientos. */
export async function saldoFavorDeCliente(db: Ejecutor, clienteId: string): Promise<string> {
  const [r] = await db
    .select({ saldo: vSaldoFavor.saldo })
    .from(vSaldoFavor)
    .where(eq(vSaldoFavor.clienteId, clienteId));
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
  d: { clienteId: string; limite?: number },
): Promise<MovSaldoFavor[]> {
  const q = db
    .select()
    .from(vSaldoFavorMov)
    .where(eq(vSaldoFavorMov.clienteId, d.clienteId))
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
  clienteId: string;
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

/**
 * D-21: la clienta retira su saldo a favor en efectivo. Idempotente (`retirarSaldoFavor`). Orden de bloqueo
 * (D-24): cliente (NO KEY UPDATE) → candado consultivo del libro (lo toma el trigger al insertar). El saldo se
 * lee con el cliente ya bloqueado, así que ningún otro escritor de saldo de la clienta lo cambia en medio.
 */
export async function retirarSaldoFavor(db: Ejecutor, d: DatosRetiro): Promise<{ saldo: string }> {
  if (!Number.isSafeInteger(d.montoCentavos) || d.montoCentavos <= 0)
    throw new ErrorNegocio('monto_invalido', 'El monto debe ser mayor que cero.', 'monto');
  const nota = d.nota?.trim() ?? '';
  if (!nota || nota.length > 200)
    throw new ErrorNegocio('nota_invalida', 'Escribe una nota del retiro (hasta 200 caracteres).', 'nota');
  if (d.fecha?.trim()) validarFecha(d.fecha);
  const payload = {
    clienteId: d.clienteId,
    monto: d.montoCentavos,
    nota,
    fecha: d.fecha?.trim() || null, // una fecha omitida se resuelve dentro de la transacción
  };
  return conSaldoInsuficienteLegible(db, d, () =>
    conErroresDeNegocio(() =>
      db.transaction((tx) =>
        conIdempotencia(
          tx,
          { key: d.key, adminId: d.adminId, operacion: 'retirarSaldoFavor', payload },
          async (): Promise<{ saldo: string }> => {
            await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo: null });
            const fecha = validarFecha(payload.fecha ?? undefined);
            const [c] = await tx
              .select({ id: cliente.id })
              .from(cliente)
              .where(eq(cliente.id, d.clienteId))
              .for('no key update');
            if (!c) throw new ErrorNegocio('no_encontrado', 'La clienta no existe.');
            const disponible = numericACentavos(await saldoFavorDeCliente(tx, d.clienteId));
            if (d.montoCentavos > disponible) throw noAlcanza(disponible, d.montoCentavos);
            await tx.insert(saldoFavorMov).values({
              clienteId: d.clienteId,
              tipo: 'retiro',
              monto: `-${centavosANumeric(d.montoCentavos)}`,
              nota,
              adminId: d.adminId,
              fecha,
            });
            return { saldo: centavosANumeric(disponible - d.montoCentavos) };
          },
        ),
      ),
    ),
  );
}

/**
 * Carrera que el bloqueo del cliente ya evita: si la BD igual rechaza con `saldo_favor_insuficiente`, se
 * traduce al mismo mensaje con el saldo real (leído fuera de la transacción que se revirtió).
 */
export async function conSaldoInsuficienteLegible<T>(
  db: Ejecutor,
  d: { clienteId: string; montoCentavos: number },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErrorNegocio && e.codigo === 'saldo_favor_insuficiente')
      throw noAlcanza(numericACentavos(await saldoFavorDeCliente(db, d.clienteId)), d.montoCentavos);
    throw e;
  }
}
