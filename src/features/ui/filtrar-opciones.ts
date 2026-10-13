import { normalizar } from '@/domain/texto';

/**
 * Filtra las opciones de un catálogo para el combobox: sin acentos ni mayúsculas (misma `normalizar` que la BD),
 * primero las que empiezan con la consulta y luego las que la contienen, cada grupo en su orden original.
 * `exacta` indica que lo escrito ya existe (entonces no se ofrece "Agregar «…»").
 */
export function filtrarOpciones(
  opciones: readonly string[],
  consulta: string,
  limite = 50,
): { opciones: string[]; exacta: boolean } {
  const q = normalizar(consulta);
  const normalizadas = opciones.map((o) => [o, normalizar(o)] as const);
  const exacta = q !== '' && normalizadas.some(([, n]) => n === q);
  if (!q) return { opciones: opciones.slice(0, limite), exacta };
  const empieza: string[] = [];
  const contiene: string[] = [];
  for (const [o, n] of normalizadas) {
    if (n.startsWith(q)) empieza.push(o);
    else if (n.includes(q)) contiene.push(o);
  }
  return { opciones: [...empieza, ...contiene].slice(0, limite), exacta };
}
