import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { pgCode } from '@/db/errors';
import type { EstadoAccion } from '@/features/ui/estado';
import { ErrorNegocio } from './errores';

/** Envuelve el cuerpo de una Server Action: éxito → { ok }, ErrorNegocio → { error }, lo demás → mensaje genérico. */
export async function ejecutarAccion(fn: () => Promise<string | void>): Promise<EstadoAccion> {
  try {
    return { ok: (await fn()) || 'Guardado.' };
  } catch (e) {
    // redirect() y notFound() lanzan errores especiales que Next debe recibir.
    unstable_rethrow(e);
    if (e instanceof ErrorNegocio) return { error: e.message };
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

/** `version` del bloqueo optimista: entero positivo. */
export function versionDe(fd: FormData): number {
  const v = texto(fd, 'version');
  if (!/^\d{1,9}$/.test(v)) throw new ErrorNegocio('conflicto', 'Recarga la página e intenta de nuevo.');
  return Number(v);
}
