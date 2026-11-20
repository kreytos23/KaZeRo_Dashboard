import { normalizarCodigo } from '@/domain/codigos';
import { normalizar } from '@/domain/texto';

/** Lo mínimo para elegir una pieza en un lote: nunca costo ni precio. */
export type PiezaElegible = {
  id: string;
  codigo: string;
  descripcion: string;
  imagenClave: string | null;
};

/**
 * Filtra en memoria la lista de elegibles (la calculó el servidor). Orden: código exacto, código que empieza
 * por la consulta, código que la contiene y, al final, descripción que la contiene. Sin acentos ni mayúsculas.
 * Las ya elegidas no se vuelven a ofrecer.
 */
export function buscarElegibles<T extends PiezaElegible>(
  piezas: readonly T[],
  consulta: string,
  elegidas: ReadonlySet<string>,
  limite = 8,
): T[] {
  const q = normalizar(consulta);
  if (!q) return [];
  const grupos: T[][] = [[], [], [], []];
  for (const p of piezas) {
    if (elegidas.has(p.codigo)) continue;
    const c = normalizar(p.codigo);
    if (c === q) grupos[0]!.push(p);
    else if (c.startsWith(q)) grupos[1]!.push(p);
    else if (c.includes(q)) grupos[2]!.push(p);
    else if (normalizar(p.descripcion).includes(q)) grupos[3]!.push(p);
  }
  return grupos.flat().slice(0, limite);
}

/** Mismos separadores que el servidor (`partirCodigos`): saltos de línea, espacios, tabuladores y comas. */
export function codigosPegados(texto: string): string[] {
  return texto
    .split(/[\s,]+/)
    .map(normalizarCodigo)
    .filter(Boolean);
}

/** Une varias listas en orden, sin duplicados: el servidor rechaza los repetidos y aquí ya no los hay. */
export function unirCodigos(...listas: readonly (readonly string[])[]): string[] {
  return [...new Set(listas.flat().map(normalizarCodigo).filter(Boolean))];
}
