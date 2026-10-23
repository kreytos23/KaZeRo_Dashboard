import { normalizar } from '@/domain/texto';
import type { EstadoPieza } from '@/server/piezas/servicio';
import { ETIQUETA_ESTADO, UBICACIONES_FILTRO, type UbicacionFiltro } from './etiquetas';

export const POR_PAGINA = 50;
const MAX_PAGINA = 1000;
/** Uuid que no existe: un nombre de catálogo desconocido filtra a cero resultados en vez de ignorarse. */
const ID_INEXISTENTE = '00000000-0000-0000-0000-000000000000';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Bruto = string | string[] | undefined;
const primero = (v: Bruto): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export interface FiltrosInventario {
  q: string;
  estado: EstadoPieza | undefined;
  /** Nombres de catálogo tal como se escriben en el filtro (se resuelven a id con `idDeCatalogo`). */
  categoria: string | undefined;
  material: string | undefined;
  proveedor: string | undefined;
  /** Dónde está la pieza (Plan 3.1). */
  ubicacion: UbicacionFiltro | undefined;
  /** Id de la vendedora; solo con la ubicación «vendedora». */
  vendedor: string | undefined;
  pagina: number;
}

/** Los searchParams son entrada del usuario: lo inválido se descarta, nunca lanza. */
export function leerFiltros(sp: Record<string, Bruto>): FiltrosInventario {
  const estado = primero(sp.estado);
  const pagina = primero(sp.pagina);
  const ubicacion = (UBICACIONES_FILTRO as readonly string[]).includes(primero(sp.ubicacion))
    ? (primero(sp.ubicacion) as UbicacionFiltro)
    : undefined;
  const vendedor = primero(sp.vendedor);
  return {
    q: primero(sp.q).slice(0, 120),
    estado: Object.hasOwn(ETIQUETA_ESTADO, estado) ? (estado as EstadoPieza) : undefined,
    categoria: nombreDeCatalogo(sp.categoria),
    material: nombreDeCatalogo(sp.material),
    proveedor: nombreDeCatalogo(sp.proveedor),
    ubicacion,
    vendedor: ubicacion === 'vendedora' && UUID.test(vendedor) ? vendedor : undefined,
    pagina: /^\d{1,10}$/.test(pagina) ? Math.min(Math.max(Number(pagina), 1), MAX_PAGINA) : 1,
  };
}

function nombreDeCatalogo(v: Bruto): string | undefined {
  const t = primero(v).trim().slice(0, 80);
  return t || undefined;
}

/**
 * Nombre escrito en un filtro → id del catálogo (misma normalización que la BD: sin acentos ni mayúsculas).
 * Vacío = sin filtro; un nombre que no existe da un id inexistente (cero resultados).
 */
export function idDeCatalogo(
  catalogo: readonly { id: string; nombre: string }[],
  nombre: string | undefined,
): string | undefined {
  if (!nombre) return undefined;
  const n = normalizar(nombre);
  return catalogo.find((c) => normalizar(c.nombre) === n)?.id ?? ID_INEXISTENTE;
}
