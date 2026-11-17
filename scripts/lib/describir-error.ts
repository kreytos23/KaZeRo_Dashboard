import { etiquetaErrorBd } from '../../src/db/reintento';

function mensajes(e: unknown): string[] {
  const out: string[] = [];
  const vistos = new Set<unknown>();
  let actual: unknown = e;
  while (actual !== null && typeof actual === 'object' && !vistos.has(actual)) {
    vistos.add(actual);
    const m = (actual as { message?: unknown }).message;
    if (typeof m === 'string') out.push(m);
    actual = (actual as { cause?: unknown }).cause;
  }
  return out;
}

/** Texto seguro para la consola al fallar un script: nunca el mensaje de un error de consulta (trae los parámetros: nombres, teléfonos). */
export function describirError(e: unknown): string {
  const causa = (e as { cause?: { code?: unknown; constraint?: unknown } } | null)?.cause;
  if (causa && typeof causa.code === 'string')
    return `Error de BD ${etiquetaErrorBd(causa)}${typeof causa.constraint === 'string' ? ` (${causa.constraint})` : ''}. ROLLBACK: no quedó nada.`;
  if (!(e instanceof Error)) return 'Error desconocido';
  if (e.name === 'DrizzleQueryError' || mensajes(e).some((m) => m.includes('params:'))) {
    const origen = e.cause === undefined ? '' : `: ${etiquetaErrorBd(e.cause)}`;
    return `${e.name}${origen}`;
  }
  return `${e.name}: ${e.message}`;
}
