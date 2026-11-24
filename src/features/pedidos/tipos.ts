export interface PiezaPrevia {
  id: string;
  codigo: string;
  descripcion: string;
  precio: string;
  estado: string;
  disponible: boolean;
  folioApartada: number | null;
  imagenClave: string | null;
  /** Plan 3.1: la vendedora que tiene la pieza en su poder (o null si está en Kazero o en un exhibidor). */
  vendedorCustodiaId: string | null;
  vendedorCustodiaNombre: string | null;
}
export interface TarjetaPrevia {
  ciclo: number;
  posicion: number;
  pctBps: number;
  /** L-7: la anterior venció (6 meses o más sin comprar) y esta nota empieza una tarjeta nueva. */
  nueva: boolean;
}
export interface PreviaPedido {
  /** En el orden pedido, sin repetidos. */
  piezas: PiezaPrevia[];
  faltantes: string[];
  cliente: { id: string; nombre: string; vendedorHabitualId: string | null } | null;
  /** null sin cliente o si no cuenta para la tarjeta. */
  tarjeta: TarjetaPrevia | null;
}
