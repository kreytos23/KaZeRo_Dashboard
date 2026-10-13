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
};

type Manual = 'regalo' | 'defecto' | 'guardada' | 'disponible';

/** Destinos manuales permitidos desde cada estado (espejo de PARES_MANUALES del servicio; el resto lo mueven pedidos y exhibidores). */
export function destinosManuales(estado: EstadoPieza): Manual[] {
  if (estado === 'disponible' || estado === 'en_exhibidor') return ['regalo', 'defecto', 'guardada'];
  if (estado === 'defecto' || estado === 'guardada') return ['disponible'];
  return [];
}

export const textoBotonFoto = (tiene: boolean) => (tiene ? 'Cambiar foto' : 'Subir foto');
