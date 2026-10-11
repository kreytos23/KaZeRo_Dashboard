import type { EstadoPieza } from '@/server/piezas/servicio';
import { ETIQUETA_ESTADO } from './etiquetas';

export const POR_PAGINA = 50;
const MAX_PAGINA = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Bruto = string | string[] | undefined;
const primero = (v: Bruto): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export interface FiltrosInventario {
  q: string;
  estado: EstadoPieza | undefined;
  categoria: string | undefined;
  pagina: number;
}

/** Los searchParams son entrada del usuario: lo inválido se descarta, nunca lanza. */
export function leerFiltros(sp: Record<string, Bruto>): FiltrosInventario {
  const estado = primero(sp.estado);
  const categoria = primero(sp.categoria);
  const pagina = primero(sp.pagina);
  return {
    q: primero(sp.q).slice(0, 120),
    estado: Object.hasOwn(ETIQUETA_ESTADO, estado) ? (estado as EstadoPieza) : undefined,
    categoria: UUID.test(categoria) ? categoria : undefined,
    pagina: /^\d{1,10}$/.test(pagina) ? Math.min(Math.max(Number(pagina), 1), MAX_PAGINA) : 1,
  };
}
