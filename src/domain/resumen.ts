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

/**
 * M-3: el descuento manual es de la nota y `precio_final` no lo trae. Se reparte en proporción, y los centavos
 * que sobran van a los residuos mayores: la suma del resultado es exactamente Σ precios − manual.
 */
export function repartirDescuento(precios: readonly number[], manual: number): number[] {
  const suma = precios.reduce((a, b) => a + b, 0);
  if (suma === 0) return precios.map(() => 0);
  const cuotas = precios.map((p, i) => ({
    i,
    cuota: Math.floor((manual * p) / suma),
    residuo: (manual * p) % suma,
  }));
  let faltan = manual - cuotas.reduce((a, c) => a + c.cuota, 0);
  for (const c of [...cuotas].sort((a, b) => b.residuo - a.residuo || a.i - b.i)) {
    if (faltan-- <= 0) break;
    c.cuota += 1;
  }
  return precios.map((p, i) => p - cuotas[i]!.cuota);
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

export function top5(importes: ReadonlyMap<string, number>): { nombre: string; centavos: number }[] {
  return [...importes]
    .map(([nombre, centavos]) => ({ nombre, centavos }))
    .sort((a, b) => b.centavos - a.centavos || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, 5);
}
