import { pgCode } from './errors';

/** Códigos de red de Node que indican que la conexión (no la consulta) falló. */
const CODIGOS_RED = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

function esObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/**
 * ¿Falló la conexión con la BD y no la consulta? Solo entonces tiene sentido reintentar una lectura.
 * - Con SQLSTATE: clase 08 (connection exception), 57P01 (admin_shutdown) o 57P03 (cannot_connect_now).
 * - Sin SQLSTATE: un error de socket/WebSocket del driver. Se excluyen los errores de negocio, los de
 *   programación (TypeError, RangeError…) y el control de flujo de Next (redirect/notFound llevan `digest`).
 */
export function esErrorDeConexion(err: unknown): boolean {
  if (!esObjeto(err)) return false;
  const code = pgCode(err);
  if (code) return code.startsWith('08') || code === '57P01' || code === '57P03';
  if (typeof err.digest === 'string') return false;
  if (err.name === 'ErrorNegocio') return false;
  if (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError
  )
    return false;
  return true;
}

/** Nombre seguro para el log: el código o el nombre del error, nunca el mensaje (puede traer la URL). */
export function etiquetaErrorBd(err: unknown): string {
  if (!esObjeto(err)) return 'desconocido';
  const code =
    pgCode(err) ?? (typeof err.code === 'string' && CODIGOS_RED.has(err.code) ? err.code : undefined);
  if (code) return code;
  return typeof err.name === 'string' ? err.name : typeof err.type === 'string' ? err.type : 'desconocido';
}

const dormirReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface OpcionesReintento {
  esperaMs?: number;
  dormir?: (ms: number) => Promise<void>;
}

/**
 * Ejecuta una LECTURA y, si falló la conexión, la repite una sola vez tras una espera corta.
 * Nunca para escrituras ni transacciones: no se sabe si el primer intento llegó a aplicarse.
 * `fn` debe abrir su propia conexión en cada intento (la del primero puede estar rota).
 */
export async function reintentarLectura<T>(
  fn: () => Promise<T>,
  opciones: OpcionesReintento = {},
): Promise<T> {
  const { esperaMs = 200, dormir = dormirReal } = opciones;
  try {
    return await fn();
  } catch (e) {
    if (!esErrorDeConexion(e)) throw e;
    console.warn('[bd] reintento de lectura tras error de conexión:', etiquetaErrorBd(e));
    await dormir(esperaMs);
    return fn();
  }
}
