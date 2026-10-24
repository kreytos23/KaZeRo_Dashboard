/** Compacto a propósito (arreglos, no objetos): miles de piezas viajan en cada carga del panel. */
export interface IndiceBusqueda {
  v: 4;
  piezas: [
    id: string,
    codigo: string,
    descripcion: string,
    estado: string,
    imagen: string | null,
    ubicacion: string | null,
  ][];
  clientes: [id: string, nombre: string, referencia: string | null][];
  vendedores: [id: string, nombre: string][];
  /** Sin montos: solo para abrir la nota por folio. */
  pedidos: [id: string, folio: number, cliente: string, estado: string][];
}
