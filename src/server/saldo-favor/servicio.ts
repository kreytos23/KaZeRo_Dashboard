import { desc, eq, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { cliente, saldoFavorMov, vendedor, vSaldoFavor, vSaldoFavorMov } from '@/db/schema';
import { centavosANumeric, centavosANumericConSigno, formatoMXN, numericACentavos } from '@/domain/dinero';
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

/** Saldo a favor vigente de la vendedora (Plan 4b: su sobrante); '0.00' si nunca tuvo movimientos. */
export async function saldoFavorDeVendedor(db: Ejecutor, vendedorId: string): Promise<string> {
  const [r] = await db
    .select({ saldo: vSaldoFavor.saldo })
    .from(vSaldoFavor)
    .where(eq(vSaldoFavor.vendedorId, vendedorId));
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
  d: { clienteId: string; limite?: number } | { vendedorId: string; limite?: number },
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
    clienteId: string | null;
    vendedorId: string | null;
    montoCentavos: number;
    nota: string;
    adminId: string;
    fecha: string;
    /** P-6: el pedido cancelado del reembolso, para que el historial del saldo lo muestre. */
    pedidoId?: string;
  },
): Promise<number> {
  const disponible = numericACentavos(
    d.clienteId ? await saldoFavorDeCliente(tx, d.clienteId) : await saldoFavorDeVendedor(tx, d.vendedorId!),
  );
  if (d.montoCentavos > disponible) throw noAlcanza(disponible, d.montoCentavos);
  await tx.insert(saldoFavorMov).values({
    clienteId: d.clienteId,
    vendedorId: d.vendedorId,
    tipo: 'retiro',
    monto: centavosANumericConSigno(-d.montoCentavos),
    nota: d.nota,
    pedidoId: d.pedidoId ?? null,
    adminId: d.adminId,
    fecha: d.fecha,
  });
  return disponible - d.montoCentavos;
}

/**
 * D-21: la clienta retira su saldo a favor en efectivo. Idempotente (`retirarSaldoFavor`). Orden de bloqueo
 * (D-24): cliente (NO KEY UPDATE) → candado consultivo del libro (lo toma el trigger al insertar). El saldo se
 * lee con el cliente ya bloqueado, así que ningún otro escritor de saldo de la clienta lo cambia en medio.
 */
export async function retirarSaldoFavor(db: Ejecutor, d: DatosRetiro): Promise<{ saldo: string }> {
  if (!Number.isSafeInteger(d.montoCentavos) || d.montoCentavos <= 0)
    throw new ErrorNegocio('monto_invalido', 'El monto debe ser mayor que cero.', 'monto');
  const nota = validarNotaRetiro(d.nota);
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
            const queda = await retirarEnTx(tx, {
              clienteId: d.clienteId,
              vendedorId: null,
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
 * P-2: la vendedora retira en efectivo su saldo a favor (el sobrante de sus pagos). Igual que el de la clienta, con
 * la fila de la vendedora bloqueada y el candado consultivo del libro que toma el trigger al insertar.
 */
export async function retirarSaldoFavorDeVendedor(
  db: Ejecutor,
  d: Omit<DatosRetiro, 'clienteId'> & { vendedorId: string },
): Promise<{ saldo: string }> {
  if (!Number.isSafeInteger(d.montoCentavos) || d.montoCentavos <= 0)
    throw new ErrorNegocio('monto_invalido', 'El monto debe ser mayor que cero.', 'monto');
  const nota = validarNotaRetiro(d.nota);
  if (d.fecha?.trim()) validarFecha(d.fecha);
  const payload = {
    vendedorId: d.vendedorId,
    monto: d.montoCentavos,
    nota,
    fecha: d.fecha?.trim() || null,
  };
  try {
    return await conErroresDeNegocio(() =>
      db.transaction((tx) =>
        conIdempotencia(
          tx,
          { key: d.key, adminId: d.adminId, operacion: 'retirarSaldoFavorDeVendedor', payload },
          async (): Promise<{ saldo: string }> => {
            await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo: null });
            const fecha = validarFecha(payload.fecha ?? undefined);
            const [v] = await tx
              .select({ id: vendedor.id })
              .from(vendedor)
              .where(eq(vendedor.id, d.vendedorId))
              .for('no key update');
            if (!v) throw new ErrorNegocio('no_encontrado', 'La vendedora no existe.');
            const queda = await retirarEnTx(tx, {
              clienteId: null,
              vendedorId: d.vendedorId,
              montoCentavos: d.montoCentavos,
              nota,
              adminId: d.adminId,
              fecha,
            });
            return { saldo: centavosANumeric(queda) };
          },
        ),
      ),
    );
  } catch (e) {
    // Carrera que el bloqueo ya evita: si la BD igual rechaza, se dice con el saldo real.
    if (e instanceof ErrorNegocio && e.codigo === 'saldo_favor_insuficiente')
      throw noAlcanza(numericACentavos(await saldoFavorDeVendedor(db, d.vendedorId)), d.montoCentavos);
    throw e;
  }
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
