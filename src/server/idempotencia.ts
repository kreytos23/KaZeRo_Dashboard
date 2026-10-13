import { createHash } from 'node:crypto';
import { eq, lt, sql } from 'drizzle-orm';
import { conDb } from '@/db/client';
import type { Db, Ejecutor } from '@/db/pool';
import { idempotencia } from '@/db/schema';
import { ErrorNegocio } from './errores';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esObjetoPlano = (v: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * JSON con llaves ordenadas: el mismo payload da el mismo hash sin importar el orden de sus propiedades.
 * Date → ISO, bigint → "123n". Rechaza lo que no tiene representación estable (NaN, ±Infinity, funciones,
 * símbolos, Map/Set/instancias de clase): un hash ambiguo dejaría pasar dos payloads distintos como iguales.
 */
export function jsonCanonico(v: unknown): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new TypeError('jsonCanonico: fecha inválida.');
    return JSON.stringify(v.toISOString());
  }
  if (typeof v === 'bigint') return JSON.stringify(`${v}n`);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('jsonCanonico: número no finito (NaN o Infinity).');
    return JSON.stringify(v);
  }
  if (typeof v === 'function' || typeof v === 'symbol')
    throw new TypeError(`jsonCanonico: un valor de tipo ${typeof v} no es serializable.`);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    if (!esObjetoPlano(v))
      throw new TypeError('jsonCanonico: solo se admiten objetos planos (no Map, Set ni clases).');
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

/** Tipo de un valor que sobrevive a ida y vuelta por jsonb sin cambiar (sin Date, bigint, undefined, funciones). */
export type JsonSeguro<T> = T extends string | number | boolean | null
  ? T
  : T extends Date | bigint | symbol | undefined | ((...a: never[]) => unknown)
    ? never
    : T extends readonly (infer U)[]
      ? JsonSeguro<U>[]
      : T extends object
        ? { [K in keyof T]: JsonSeguro<T[K]> }
        : never;

/** Comprobación en ejecución: el resultado guardado debe ser idéntico al devuelto en la primera llamada. */
function asegurarJsonSeguro(v: unknown, ruta = 'resultado'): void {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`conIdempotencia: ${ruta} contiene un número no finito.`);
    return;
  }
  if (Array.isArray(v)) return v.forEach((x, i) => asegurarJsonSeguro(x, `${ruta}[${i}]`));
  if (typeof v === 'object' && esObjetoPlano(v)) {
    for (const [k, x] of Object.entries(v)) asegurarJsonSeguro(x, `${ruta}.${k}`);
    return;
  }
  throw new TypeError(`conIdempotencia: ${ruta} no es JSON seguro (${typeof v}); devuelve un DTO simple.`);
}

/**
 * Spec §6: lo primero dentro de la transacción del servicio. Si la transacción se revierte, la key también,
 * así que el reintento es limpio.
 *
 * REQUIERE READ COMMITTED (el aislamiento por defecto de Postgres; se verifica abajo). Con dos envíos
 * simultáneos, el INSERT ... ON CONFLICT DO NOTHING del segundo espera a que el primero confirme y luego,
 * con una sentencia nueva (instantánea nueva), lee su resultado. En REPEATABLE READ no lo vería.
 *
 * La identidad guardada incluye al administrador (`<adminId>:<operacion>` en la columna `operacion`): una key
 * ajena nunca devuelve el resultado de otro administrador.
 */
export async function conIdempotencia<T extends object>(
  tx: Ejecutor,
  o: { key: string; adminId: string; operacion: string; payload: unknown },
  fn: () => Promise<T>,
): Promise<[T] extends [JsonSeguro<T>] ? T : never> {
  type R = [T] extends [JsonSeguro<T>] ? T : never;
  if (!UUID.test(o.key) || !UUID.test(o.adminId) || o.operacion === '')
    throw new ErrorNegocio('idempotencia', 'Solicitud inválida.');
  const payloadHash = hashPayload(o.payload);
  const identidad = `${o.adminId.toLowerCase()}:${o.operacion}`;

  const nivel = (await tx.execute<{ n: string }>(sql`SELECT current_setting('transaction_isolation') AS n`))
    .rows[0]?.n;
  if (nivel !== 'read committed')
    throw new Error(`conIdempotencia requiere READ COMMITTED (hay ${String(nivel)}).`);

  const nueva = await tx
    .insert(idempotencia)
    .values({ key: o.key, operacion: identidad, payloadHash })
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
    if (!previa) throw new ErrorNegocio('idempotencia', 'Solicitud inválida.');
    const [adminPrevio, ...resto] = previa.operacion.split(':');
    if (adminPrevio !== o.adminId.toLowerCase())
      throw new ErrorNegocio('idempotencia', 'Solicitud inválida.');
    if (resto.join(':') !== o.operacion)
      throw new ErrorNegocio(
        'idempotencia',
        'Esta clave de envío ya se usó en otra operación. Recarga la página.',
      );
    if (previa.payloadHash !== payloadHash)
      throw new ErrorNegocio(
        'idempotencia',
        'Este formulario ya se envió con otros datos. Recarga la página.',
      );
    if (previa.resultado === null)
      throw new ErrorNegocio(
        'idempotencia',
        'El envío anterior con esta clave no quedó completo. Recarga la página e inténtalo de nuevo.',
      );
    return previa.resultado as R;
  }
  const resultado = await fn();
  asegurarJsonSeguro(resultado);
  await tx.update(idempotencia).set({ resultado }).where(eq(idempotencia.key, o.key));
  return resultado as R;
}

export const RETENCION_IDEMPOTENCIA_DIAS = 30;

/** Limpieza diaria (cron): borra claves de más de 30 días. Devuelve solo el conteo. */
export async function limpiarIdempotencia(db: Db, ahora: Date = new Date()): Promise<number> {
  const limite = new Date(ahora.getTime() - RETENCION_IDEMPOTENCIA_DIAS * 86_400_000);
  const borradas = await db
    .delete(idempotencia)
    .where(lt(idempotencia.createdAt, limite))
    .returning({ key: idempotencia.key });
  return borradas.length;
}

/** Para el cron: el borrado es idempotente, y la conexión (sin reintento automático) se abre aquí, no en la ruta. */
export const limpiarIdempotenciaCron = (): Promise<number> => conDb((db) => limpiarIdempotencia(db));
