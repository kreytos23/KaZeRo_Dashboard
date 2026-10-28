import 'server-only';
import { GRUPO_RAICES, esRutaImagen } from '@/domain/imagenes';

/** Defensa en profundidad: toda implementación valida la ruta antes de tocar nada. */
export function exigirRuta(ruta: string): string {
  if (!esRutaImagen(ruta)) throw new RangeError('Ruta de imagen inválida');
  return ruta;
}

// Prefijo parcial de una ruta de foto: `piezas/`, `comprobantes/`, `piezas/<uuid>/`, `piezas/<uuid>/<medio uuid>`…
const PREFIJO = new RegExp(`^${GRUPO_RAICES}/[0-9a-f-]*(/[0-9a-f-]*)?$`);

export function exigirPrefijo(prefijo: string): string {
  if (!PREFIJO.test(prefijo)) throw new RangeError('Prefijo de imagen inválido');
  return prefijo;
}

export const LIMITE_LISTA = 1000;

export function exigirLimite(limite: number): number {
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_LISTA)
    throw new RangeError('Límite inválido');
  return limite;
}

/**
 * Paginación por cursor sobre rutas (disco y memoria). El cursor es la última ruta devuelta;
 * debe ser una ruta de foto válida (nunca texto libre del cliente).
 */
export function paginarRutas(
  rutas: readonly string[],
  prefijo: string,
  cursor: string | undefined,
  limite: number,
): { pagina: string[]; siguiente: string | null } {
  exigirPrefijo(prefijo);
  exigirLimite(limite);
  if (cursor !== undefined) exigirRuta(cursor);
  const candidatas = rutas
    .filter((r) => esRutaImagen(r) && r.startsWith(prefijo) && (cursor === undefined || r > cursor))
    .sort();
  const pagina = candidatas.slice(0, limite);
  return { pagina, siguiente: candidatas.length > limite ? pagina[pagina.length - 1]! : null };
}
