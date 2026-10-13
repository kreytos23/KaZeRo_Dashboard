import type { EstadoPedido } from '@/server/pedidos/comun';

export const ETIQUETA_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  abierto: 'Abierto',
  liquidado: 'Liquidado',
  cancelado: 'Cancelado',
};

export const ETIQUETA_METODO = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  otro: 'Otro',
} as const;

/** '2026-10-12' → '12/10/2026' (fecha de negocio, sin zona horaria). */
export function fechaCorta(iso: string): string {
  return iso.split('-').reverse().join('/');
}
