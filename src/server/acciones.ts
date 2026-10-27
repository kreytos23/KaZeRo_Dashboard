import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { pgCode } from '@/db/errors';
import { MAX_BYTES_SUBIDA } from '@/domain/imagenes';
import type { EstadoAccion } from '@/features/ui/estado';
import { ErrorNegocio } from './errores';

/** Envuelve el cuerpo de una Server Action: éxito → { ok }, ErrorNegocio → { error }, lo demás → mensaje genérico. */
export async function ejecutarAccion(fn: () => Promise<string | void>): Promise<EstadoAccion> {
  try {
    // `||` a propósito: una cadena vacía también cae al mensaje por defecto, para que siempre haya un status visible.
    return { ok: (await fn()) || 'Guardado.' };
  } catch (e) {
    // redirect() y notFound() lanzan errores especiales que Next debe recibir.
    unstable_rethrow(e);
    if (e instanceof ErrorNegocio)
      return e.campo ? { error: e.message, campos: { [e.campo]: e.message } } : { error: e.message };
    // Solo el código: el mensaje de un error de BD puede incluir valores (datos personales).
    console.error('[accion] error inesperado', pgCode(e) ?? (e instanceof Error ? e.name : typeof e));
    return { error: 'No se pudo guardar. Intenta de nuevo.' };
  }
}

/** Campo de texto de un FormData; un archivo o un campo ausente cuentan como vacío. */
export function texto(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id oculto del formulario: nunca se confía en él más allá de que tenga forma de uuid. */
export function uuidDe(fd: FormData, campo: string): string {
  const v = texto(fd, campo);
  if (!UUID.test(v)) throw new ErrorNegocio('no_encontrado', 'Registro no encontrado.');
  return v;
}

/** Uuid opcional: vacío → null. */
export function uuidOpcionalDe(fd: FormData, campo: string): string | null {
  return texto(fd, campo) === '' ? null : uuidDe(fd, campo);
}

/** Uuid de un parámetro de URL: ausente o inválido → null (sin filtro). */
export function uuidOpcional(valor: string | null | undefined): string | null {
  return valor && UUID.test(valor) ? valor : null;
}

/** `version` del bloqueo optimista: entero positivo. */
export function versionDe(fd: FormData): number {
  const v = texto(fd, 'version');
  if (!/^\d{1,9}$/.test(v)) throw new ErrorNegocio('conflicto', 'Recarga la página e intenta de nuevo.');
  return Number(v);
}

/**
 * Archivo de un FormData. El tamaño se revisa ANTES de leerlo (también si es opcional); el contenido
 * (magic bytes, dimensiones, animadas) lo valida `procesarImagen`. Nunca se confía en el nombre ni el MIME.
 */
export async function bytesDeArchivo(fd: FormData, campo: string): Promise<Uint8Array>;
export async function bytesDeArchivo(
  fd: FormData,
  campo: string,
  o: { opcional?: boolean },
): Promise<Uint8Array | null>;
export async function bytesDeArchivo(
  fd: FormData,
  campo: string,
  o: { opcional?: boolean } = {},
): Promise<Uint8Array | null> {
  const v = fd.get(campo);
  if (!(v instanceof File) || v.size === 0) {
    if (o.opcional) return null;
    throw new ErrorNegocio('imagen', 'Elige una foto.', campo);
  }
  if (v.size > MAX_BYTES_SUBIDA) throw new ErrorNegocio('imagen', 'La foto pesa más de 3 MB.', campo);
  return new Uint8Array(await v.arrayBuffer());
}
