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
  conSaldo: boolean;
  pagina: number;
}

/** Los searchParams son entrada del usuario: lo inválido se descarta, nunca lanza. */
export function leerFiltrosPedidos(sp: Record<string, Bruto>): FiltrosPedidosUrl {
  const estado = primero(sp.estado);
  const vendedor = primero(sp.vendedor);
  const pagina = primero(sp.pagina);
  return {
    q: primero(sp.q).slice(0, 120),
    estado: Object.hasOwn(ETIQUETA_ESTADO_PEDIDO, estado) ? (estado as EstadoPedido) : undefined,
    vendedor: UUID.test(vendedor) ? vendedor : undefined,
    conSaldo: primero(sp.saldo) === '1',
    pagina: /^\d{1,10}$/.test(pagina) ? Math.min(Math.max(Number(pagina), 1), MAX_PAGINA) : 1,
  };
}
