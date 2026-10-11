import 'server-only';
import { env } from '@/server/env';
import { conDbUrl, type Db } from './pool';
import { reintentarLectura } from './reintento';

export type { Db };

/** Conexión para Server Actions y escrituras: sin reintentos (no se sabe si el primer intento se aplicó). */
export function conDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return conDbUrl(env().DATABASE_URL, fn);
}

/**
 * Solo LECTURAS (páginas, Server Components, Route Handlers GET): si falla la conexión, se reintenta
 * una vez con un pool nuevo. `fn` no debe escribir ni abrir transacciones.
 */
export function conDbLectura<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return reintentarLectura(() => conDb(fn));
}
