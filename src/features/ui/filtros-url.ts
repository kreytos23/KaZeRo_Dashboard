export interface FiltroActivo {
  clave: string;
  /** Texto legible del filtro: «Anillos», «Plata», «Abiertos». */
  etiqueta: string;
}

/** ¿Hay algún filtro puesto? La página no cuenta. */
export function hayFiltros(sp: URLSearchParams, claves: readonly string[]): boolean {
  return claves.some((c) => sp.has(c));
}

function sinClaves(ruta: string, sp: URLSearchParams, claves: readonly string[]): string {
  const copia = new URLSearchParams(sp);
  for (const c of [...claves, 'pagina']) copia.delete(c);
  const qs = copia.toString();
  return qs ? `${ruta}?${qs}` : ruta;
}

/** URL sin ninguno de los filtros (ni la página). */
export function urlSinFiltros(ruta: string, sp: URLSearchParams, claves: readonly string[]): string {
  return sinClaves(ruta, sp, claves);
}

/** URL sin un filtro (ni la página). */
export function urlSinFiltro(ruta: string, sp: URLSearchParams, clave: string): string {
  return sinClaves(ruta, sp, [clave]);
}
