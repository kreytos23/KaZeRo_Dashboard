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

/** Para mostrar pagos ya registrados: incluye el pago con saldo a favor (Plan 3.1), que no se elige en el formulario. */
export const ETIQUETA_METODO_REGISTRADO = { ...ETIQUETA_METODO, saldo_favor: 'Saldo a favor' } as const;

export { fechaCorta } from '@/domain/fechas';
