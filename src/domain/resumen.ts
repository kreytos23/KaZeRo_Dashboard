import { finDeMes, mesAnterior, mesDe } from './comisiones';
import { parsearFechaISO } from './fechas';

export type ClavePeriodo = 'mes' | 'anterior' | 'anio' | 'rango';

export interface Periodo {
  clave: ClavePeriodo;
  desde: string;
  hasta: string;
  /** Pidieron un rango que no vale: se muestra este mes con aviso. */
  invalido: boolean;
}

export function periodoDeUrl(
  p: { periodo?: string | null; desde?: string | null; hasta?: string | null },
  hoy: string,
): Periodo {
  const esteMes = (invalido: boolean): Periodo => ({ clave: 'mes', desde: mesDe(hoy), hasta: hoy, invalido });
  if (p.periodo === 'anterior') {
    const desde = mesAnterior(mesDe(hoy));
    return { clave: 'anterior', desde, hasta: finDeMes(desde), invalido: false };
  }
  if (p.periodo === 'anio')
    return { clave: 'anio', desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy, invalido: false };
  if (p.periodo === 'rango') {
    const desde = parsearFechaISO(p.desde ?? '');
    const hasta = parsearFechaISO(p.hasta ?? '');
    return desde && hasta && desde <= hasta
      ? { clave: 'rango', desde, hasta, invalido: false }
      : esteMes(true);
  }
  return esteMes(false);
}

export interface LineaVendida {
  importe: number;
  costo: number;
  categoria: string;
  devuelta: boolean;
}

export interface ResumenLineas {
  margenCentavos: number;
  baseMargenCentavos: number;
  piezasSinCosto: number;
  categorias: Map<string, number>;
}

/** M-4 y M-5. Las devueltas no cuentan; las piezas sin costo solo cuentan en categorías y en el aviso. */
export function resumirLineas(lineas: readonly LineaVendida[]): ResumenLineas {
  const r: ResumenLineas = {
    margenCentavos: 0,
    baseMargenCentavos: 0,
    piezasSinCosto: 0,
    categorias: new Map(),
  };
  for (const l of lineas) {
    if (l.devuelta) continue;
    r.categorias.set(l.categoria, (r.categorias.get(l.categoria) ?? 0) + l.importe);
    if (l.costo === 0) {
      r.piezasSinCosto += 1;
      continue;
    }
    r.margenCentavos += l.importe - l.costo;
    r.baseMargenCentavos += l.importe;
  }
  return r;
}

export interface FilaTop {
  /** Clienta o asociado; las categorías se agrupan por nombre y no lo llevan. */
  id?: string;
  nombre: string;
  centavos: number;
}

/** Los 5 mayores; empate por nombre y, si dos se llaman igual, por id (orden estable). */
export function top5<T extends FilaTop>(filas: Iterable<T>): T[] {
  return [...filas]
    .sort(
      (a, b) =>
        b.centavos - a.centavos ||
        a.nombre.localeCompare(b.nombre, 'es') ||
        (a.id ?? '').localeCompare(b.id ?? ''),
    )
    .slice(0, 5);
}
