/** Compacto a propósito (arreglos, no objetos): miles de piezas viajan en cada carga del panel. */
export interface IndiceBusqueda {
  v: 1;
  piezas: [id: string, codigo: string, descripcion: string, estado: string][];
  clientes: [id: string, nombre: string, referencia: string | null][];
  vendedores: [id: string, nombre: string][];
}
