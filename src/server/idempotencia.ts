import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { idempotencia } from '@/db/schema';
import { ErrorNegocio } from './errores';

/** JSON con llaves ordenadas: el mismo payload da el mismo hash sin importar el orden de sus propiedades. */
export function jsonCanonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const partes = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`);
    return `{${partes.join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function hashPayload(p: unknown): string {
  return createHash('sha256').update(jsonCanonico(p)).digest('hex');
}

/**
 * Spec §6: lo primero dentro de la transacción del servicio. Si la transacción se revierte, la key también,
 * así que el reintento es limpio. Con dos envíos simultáneos, el INSERT del segundo espera a que el primero
 * confirme (conflicto de PK) y luego ve su resultado.
 */
export async function conIdempotencia<T extends object>(
  tx: Ejecutor,
  o: { key: string; operacion: string; payload: unknown },
  fn: () => Promise<T>,
): Promise<T> {
  const payloadHash = hashPayload(o.payload);
  const nueva = await tx
    .insert(idempotencia)
    .values({ key: o.key, operacion: o.operacion, payloadHash })
    .onConflictDoNothing()
    .returning({ key: idempotencia.key });
  if (nueva.length === 0) {
    const [previa] = await tx
      .select({
        operacion: idempotencia.operacion,
        payloadHash: idempotencia.payloadHash,
        resultado: idempotencia.resultado,
      })
      .from(idempotencia)
      .where(eq(idempotencia.key, o.key));
    if (
      !previa ||
      previa.operacion !== o.operacion ||
      previa.payloadHash !== payloadHash ||
      previa.resultado === null
    )
      throw new ErrorNegocio(
        'idempotencia',
        'Este formulario ya se envió con otros datos. Recarga la página.',
      );
    return previa.resultado as T;
  }
  const resultado = await fn();
  await tx.update(idempotencia).set({ resultado }).where(eq(idempotencia.key, o.key));
  return resultado;
}
