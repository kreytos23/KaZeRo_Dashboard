/** Lógica pura de la paginación numerada (sin React ni BD): ventana de páginas, puntos suspensivos y rango mostrado. */

export const VENTANA_PAGINAS = 5;

export type ElementoPaginacion = { tipo: 'pagina'; numero: number } | { tipo: 'hueco'; clave: string };

export interface Paginacion {
  /** Página actual ya acotada a 1..totalPaginas. */
  pagina: number;
  totalPaginas: number;
  total: number;
  /** Rango 1-based de filas mostradas (0–0 si no hay filas). */
  desde: number;
  hasta: number;
  /** Primera, ventana alrededor de la actual y última, con huecos («…») donde faltan páginas. */
  elementos: ElementoPaginacion[];
}

export const totalDePaginas = (total: number, porPagina: number): number =>
  Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, porPagina)));

/** Acota la página pedida (entrada del usuario) a la última existente; lo inválido es la página 1. */
export function acotarPagina(pagina: number, total: number, porPagina: number): number {
  const n = Number.isFinite(pagina) ? Math.trunc(pagina) : 1;
  return Math.min(Math.max(n, 1), totalDePaginas(total, porPagina));
}

/**
 * Números de página visibles: siempre la 1 y la última, más una ventana de `ventana` páginas que sigue a la
 * actual y se pega al borde cerca de los extremos. Un hueco de una sola página se muestra como número
 * (un «…» que oculta una sola página no ahorra nada).
 */
export function elementosPaginacion(
  pagina: number,
  totalPaginas: number,
  ventana = VENTANA_PAGINAS,
): ElementoPaginacion[] {
  const ultima = Math.max(1, Math.trunc(totalPaginas));
  const actual = Math.min(Math.max(Math.trunc(pagina) || 1, 1), ultima);
  const ancho = Math.min(Math.max(Math.trunc(ventana), 1), ultima);
  let ini = actual - Math.floor(ancho / 2);
  ini = Math.min(Math.max(ini, 1), ultima - ancho + 1);
  const fin = ini + ancho - 1;

  const numeros = new Set<number>([1, ultima]);
  for (let n = ini; n <= fin; n++) numeros.add(n);
  const orden = [...numeros].sort((a, b) => a - b);

  const salida: ElementoPaginacion[] = [];
  let previo = 0;
  for (const n of orden) {
    if (previo && n - previo === 2) salida.push({ tipo: 'pagina', numero: previo + 1 });
    else if (previo && n - previo > 2) salida.push({ tipo: 'hueco', clave: `hueco-${previo}` });
    salida.push({ tipo: 'pagina', numero: n });
    previo = n;
  }
  return salida;
}

export function calcularPaginacion(p: { pagina: number; total: number; porPagina: number }): Paginacion {
  const total = Math.max(0, Math.trunc(p.total));
  const totalPaginas = totalDePaginas(total, p.porPagina);
  const pagina = acotarPagina(p.pagina, total, p.porPagina);
  return {
    pagina,
    totalPaginas,
    total,
    desde: total === 0 ? 0 : (pagina - 1) * p.porPagina + 1,
    hasta: Math.min(pagina * p.porPagina, total),
    elementos: elementosPaginacion(pagina, totalPaginas),
  };
}
