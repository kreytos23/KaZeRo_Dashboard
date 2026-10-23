import { normalizar } from '../../src/domain/texto';

/** M-04: llave de comparación de nombres (paridad con `normalizar`, sin puntuación ni espacios dobles). */
export function llaveNombre(t: string): string {
  return normalizar(t.replace(/[^\p{L}\p{N}\s]/gu, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
