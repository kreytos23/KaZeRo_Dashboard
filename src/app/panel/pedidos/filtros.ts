import { parsearFechaISO } from '@/domain/fechas';
import type { EstadoPedido } from '@/server/pedidos/comun';
import { ETIQUETA_ESTADO_PEDIDO } from './etiquetas';

export const POR_PAGINA = 50;
const MAX_PAGINA = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Bruto = string | string[] | undefined;
const primero = (v: Bruto): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export interface FiltrosPedidosUrl {
  q: string;
  estado: EstadoPedido | undefined;
  vendedor: string | undefined;
  cliente: string | undefined;
  /** YYYY-MM-DD válidos (calendario real) o undefined. */
  desde: string | undefined;
  hasta: string | undefined;
  conSaldo: boolean;
  pagina: number;
}

/** Los searchParams son entrada del usuario: lo inválido se descarta, nunca lanza. */
export function leerFiltrosPedidos(sp: Record<string, Bruto>): FiltrosPedidosUrl {
  const estado = primero(sp.estado);
  const vendedor = primero(sp.vendedor);
  const cliente = primero(sp.cliente);
  const pagina = primero(sp.pagina);
  return {
    q: primero(sp.q).slice(0, 120),
    estado: Object.hasOwn(ETIQUETA_ESTADO_PEDIDO, estado) ? (estado as EstadoPedido) : undefined,
    vendedor: UUID.test(vendedor) ? vendedor : undefined,
    cliente: UUID.test(cliente) ? cliente : undefined,
    desde: parsearFechaISO(primero(sp.desde)) ?? undefined,
    hasta: parsearFechaISO(primero(sp.hasta)) ?? undefined,
    conSaldo: primero(sp.saldo) === '1',
    pagina: /^\d{1,10}$/.test(pagina) ? Math.min(Math.max(Number(pagina), 1), MAX_PAGINA) : 1,
  };
}
