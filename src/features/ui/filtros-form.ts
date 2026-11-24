import { parsearFechaISO } from '@/domain/fechas';

/**
 * Lógica pura de FormFiltros: los filtros de un reporte se aplican solos al cambiar.
 */

/** Consulta de la URL a partir de los campos del formulario, sin los vacíos ni archivos (`?a=1&b=2`, sin `?`). */
export function consultaDeFiltros(entradas: Iterable<[string, FormDataEntryValue]>): string {
  const sp = new URLSearchParams();
  for (const [clave, valor] of entradas) {
    if (typeof valor === 'string' && valor !== '') sp.append(clave, valor);
  }
  return sp.toString();
}

/** Ruta con su consulta; sin consulta, la ruta sola. */
export function urlDeFiltros(ruta: string, consulta: string): string {
  return consulta ? `${ruta}?${consulta}` : ruta;
}

export interface EstadoFecha {
  /** Lo que el campo enviaría: aaaa-mm-dd o ''. */
  valor: string;
  /** La persona escribió algo que aún no es una fecha completa (el valor enviado sería ''). */
  aMedias: boolean;
}

/** Solo se navega si cada fecha está vacía o completa y válida: nunca con una fecha a medias. */
export function fechasListas(fechas: readonly EstadoFecha[]): boolean {
  return fechas.every((f) => !f.aMedias && (f.valor === '' || parsearFechaISO(f.valor) === f.valor));
}
