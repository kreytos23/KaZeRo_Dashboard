export interface PiezaPrevia {
  id: string;
  codigo: string;
  descripcion: string;
  precio: string;
  estado: string;
  disponible: boolean;
  folioApartada: number | null;
  imagenClave: string | null;
}
export interface TarjetaPrevia {
  ciclo: number;
  posicion: number;
  pctBps: number;
}
export interface PreviaPedido {
  /** En el orden pedido, sin repetidos. */
  piezas: PiezaPrevia[];
  faltantes: string[];
  cliente: { id: string; nombre: string; vendedorHabitualId: string | null } | null;
  /** null sin cliente o si no cuenta para la tarjeta. */
  tarjeta: TarjetaPrevia | null;
}
