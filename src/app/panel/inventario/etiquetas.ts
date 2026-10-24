import { formatoFolio } from '@/domain/pedidos';
import type { EstadoPieza } from '@/server/piezas/servicio';

export const ETIQUETA_ESTADO: Record<EstadoPieza, string> = {
  disponible: 'Disponible',
  en_exhibidor: 'En exhibidor',
  apartada: 'Apartada',
  vendida: 'Vendida',
  regalo: 'Regalo',
  defecto: 'Defecto',
  guardada: 'Guardada',
};

export const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  alta: 'Alta',
  envio_exhibidor: 'Enviada a exhibidor',
  regreso: 'Regresó de exhibidor',
  venta: 'Vendida',
  cancelacion_venta: 'Venta cancelada',
  cambio_estado: 'Cambio de estado',
  correccion: 'Corrección',
  apartado: 'Apartada en pedido',
  liberacion: 'Liberada',
  // Plan 3.1.
  entrega_vendedora: 'Entregada a vendedora',
  regreso_vendedora: 'Regresó de vendedora',
  devolucion: 'Devuelta por defecto',
};

/** Texto del movimiento en el historial de la pieza; los de custodia y devolución nombran a la vendedora o al pedido. */
export function textoMovimiento(m: {
  tipo: string;
  vendedorNombre: string | null;
  pedidoFolio: number | null;
}): string {
  const vendedora = m.vendedorNombre ?? 'vendedora';
  switch (m.tipo) {
    case 'entrega_vendedora':
      return `Entregada a ${vendedora}`;
    case 'regreso_vendedora':
      return m.vendedorNombre ? `Regresó a Kazero de ${m.vendedorNombre}` : 'Regresó a Kazero de vendedora';
    case 'devolucion':
      return m.pedidoFolio === null
        ? 'Devuelta por defecto'
        : `Devuelta por defecto (${formatoFolio(m.pedidoFolio)})`;
    default:
      return ETIQUETA_MOVIMIENTO[m.tipo] ?? m.tipo;
  }
}

/** Filtro «Ubicación» del inventario: valores de la URL. */
export const UBICACIONES_FILTRO = ['kazero', 'exhibidor', 'vendedora'] as const;
export type UbicacionFiltro = (typeof UBICACIONES_FILTRO)[number];
export const ETIQUETA_UBICACION_FILTRO: Record<UbicacionFiltro, string> = {
  kazero: 'Kazero',
  exhibidor: 'Exhibidor',
  vendedora: 'Con vendedora',
};

type Manual = 'regalo' | 'defecto' | 'guardada' | 'disponible';

/** Destinos manuales permitidos desde cada estado (espejo de PARES_MANUALES del servicio; el resto lo mueven pedidos y exhibidores). */
export function destinosManuales(estado: EstadoPieza): Manual[] {
  if (estado === 'disponible' || estado === 'en_exhibidor') return ['regalo', 'defecto', 'guardada'];
  if (estado === 'defecto' || estado === 'guardada') return ['disponible'];
  return [];
}

export const textoBotonFoto = (tiene: boolean) => (tiene ? 'Cambiar foto' : 'Subir foto');
