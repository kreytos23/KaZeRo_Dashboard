/** URL sin las claves dadas ni la página. */
export function urlSin(ruta: string, sp: URLSearchParams, claves: readonly string[]): string {
  const copia = new URLSearchParams(sp);
  for (const c of [...claves, 'pagina']) copia.delete(c);
  const qs = copia.toString();
  return qs ? `${ruta}?${qs}` : ruta;
}

/**
 * Un filtro de un listado: `valor` es lo que va en la URL (vacío = no va) y `etiqueta` el texto legible del chip
 * («Anillos», «Abiertos»); sin `etiqueta` el filtro está puesto pero no se muestra (p. ej. ubicación implícita).
 */
export interface DefFiltro {
  clave: string;
  valor?: string | null;
  etiqueta?: string | null;
}

/** De las definiciones salen los chips activos (cada uno con su URL sin él) y la URL que los quita todos. */
export function filtrosActivos(ruta: string, defs: readonly DefFiltro[]) {
  const sp = new URLSearchParams(defs.flatMap((d) => (d.valor ? [[d.clave, d.valor]] : [])));
  return {
    activos: defs.flatMap((d) =>
      d.etiqueta ? [{ clave: d.clave, etiqueta: d.etiqueta, href: urlSin(ruta, sp, [d.clave]) }] : [],
    ),
    hrefLimpiar: urlSin(
      ruta,
      sp,
      defs.map((d) => d.clave),
    ),
  };
}
