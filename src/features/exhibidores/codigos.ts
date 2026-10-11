import { ErrorNegocio } from '@/server/errores';

/** 500 códigos de hasta 20 caracteres con separadores caben de sobra; más es abuso. */
export const MAX_CARACTERES_CODIGOS = 20_000;

/** Corta el tamaño ANTES de partir el texto; separadores: saltos de línea, comas, espacios y tabuladores. */
export function partirCodigos(crudo: string): string[] {
  if (crudo.length > MAX_CARACTERES_CODIGOS)
    throw new ErrorNegocio('sin_codigos', 'El texto de códigos es demasiado grande. Máximo 500 piezas.');
  return crudo.split(/[\s,]+/).filter(Boolean);
}
