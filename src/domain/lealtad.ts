import { sumarMeses } from './fechas';

/**
 * Tarjeta de lealtad (R-20 a R-28; R-29 derogada 2026-10-23). Lógica pura: la usa el servicio (autoridad) y la UI (vista previa).
 * Las compras previas de la tarjeta de papel (L-1, 2026-11-16) ocupan los lugares 1..n de la primera tarjeta.
 * L-7 (2026-11-24): con 6 meses o más sin comprar, la siguiente nota empieza una tarjeta nueva.
 */
export interface ReglasLealtad {
  /** R-21: posiciones por ciclo. */
  tamanoCiclo: number;
  /** R-22: posición → descuento en centésimas de punto (1000 = 10 %). */
  descuentosBps: Readonly<Record<number, number>>;
}

export const REGLAS_LEALTAD: ReglasLealtad = { tamanoCiclo: 10, descuentosBps: { 5: 1000, 10: 2000 } };

export interface Posicion {
  ciclo: number;
  posicion: number;
}

/** L-7: meses de calendario sin comprar tras los que la tarjeta vence. */
export const MESES_VENCIMIENTO = 6;

/** L-7: día en que vence la tarjeta (la regla de `date + interval '6 months'` de Postgres). */
export function vencimientoTarjeta(ultimaCompra: string): string {
  return sumarMeses(ultimaCompra, MESES_VENCIMIENTO);
}

/** L-7: la nota con fecha `fecha` vence la tarjeta si cae el mismo día seis meses después de la última compra o más tarde. */
export function tarjetaVencida(ultimaCompra: string | null, fecha: string): boolean {
  return ultimaCompra !== null && fecha >= vencimientoTarjeta(ultimaCompra);
}

/**
 * L-7: la última compra es la fecha más reciente entre las notas vigentes que cuentan para la tarjeta (de cualquier
 * vuelta) y la fecha de las compras previas. Las fechas son 'AAAA-MM-DD': se comparan como texto.
 */
export function ultimaCompra(fechas: readonly (string | null | undefined)[]): string | null {
  let max: string | null = null;
  for (const f of fechas) if (f && (max === null || f > max)) max = f;
  return max;
}

/** L-7: la última compra y la fecha de la nota que se va a crear. */
export interface Vencimiento {
  ultimaCompra: string | null;
  fecha: string;
}

/** Sin vencimiento: la migración del Excel reproduce la hoja tal cual, sin la regla L-7. */
export const SIN_VENCIMIENTO: Vencimiento = { ultimaCompra: null, fecha: '' };

/**
 * D-2 (Plan 3.1): la tarjeta actual es la vuelta más alta con algún pedido vigente (las previas son la vuelta 1).
 * Se toma su lugar libre más bajo (un lugar cancelado de la tarjeta actual se reutiliza); si está llena, vuelta
 * nueva en el 1. Los huecos de vueltas anteriores NO se rellenan. L-7: si la tarjeta venció, vuelta nueva en el 1.
 */
export function siguientePosicion(
  ocupadas: readonly Posicion[],
  vencimiento: Vencimiento,
  reglas = REGLAS_LEALTAD,
): Posicion {
  if (!ocupadas.length) return { ciclo: 1, posicion: 1 };
  const actual = ocupadas.reduce((m, o) => Math.max(m, o.ciclo), 1);
  if (tarjetaVencida(vencimiento.ultimaCompra, vencimiento.fecha)) return { ciclo: actual + 1, posicion: 1 };
  const usadas = new Set(ocupadas.filter((o) => o.ciclo === actual).map((o) => o.posicion));
  for (let posicion = 1; posicion <= reglas.tamanoCiclo; posicion++)
    if (!usadas.has(posicion)) return { ciclo: actual, posicion };
  return { ciclo: actual + 1, posicion: 1 };
}

/** L-1: las compras previas son los lugares 1..n del ciclo 1, ocupados sin nota. */
export function conPrevias(ocupadas: readonly Posicion[], previas: number): Posicion[] {
  return [...ocupadas, ...Array.from({ length: previas }, (_, i) => ({ ciclo: 1, posicion: i + 1 }))];
}

/** R-22 / R-28. R-29 derogada (reunión 2026-10-23): el descuento no depende de otras notas con saldo. */
export function descuentoLealtad(
  d: { cuentaTarjeta: boolean; posicion: number | null },
  reglas = REGLAS_LEALTAD,
): { pctBps: number } {
  if (!d.cuentaTarjeta || d.posicion === null) return { pctBps: 0 };
  return { pctBps: reglas.descuentosBps[d.posicion] ?? 0 };
}

export interface Casilla {
  posicion: number;
  /** 'previa' = compra de la tarjeta de papel (L-1): ocupada, sin folio. */
  estado: 'ocupada' | 'libre' | 'previa';
  folio: number | null;
  pctBps: number;
  conSaldo: boolean;
}
export interface Tarjeta {
  casillas: Casilla[];
  ocupadas: number;
}

/** R-25 (D-4): solo la tarjeta actual. Ocupada = pedido no cancelado (cuenta al crear); conSaldo es informativo. */
export function armarTarjeta(
  pedidos: readonly {
    ciclo: number;
    posicion: number;
    estado: 'abierto' | 'liquidado';
    folio: number;
    conSaldo: boolean;
  }[],
  previas = 0,
  reglas = REGLAS_LEALTAD,
): Tarjeta {
  const actual = pedidos.reduce((m, p) => Math.max(m, p.ciclo), 1);
  const casillas: Casilla[] = Array.from({ length: reglas.tamanoCiclo }, (_, i) => ({
    posicion: i + 1,
    estado: actual === 1 && i < previas ? 'previa' : 'libre',
    folio: null,
    pctBps: reglas.descuentosBps[i + 1] ?? 0,
    conSaldo: false,
  }));
  for (const p of pedidos) {
    const c = p.ciclo === actual ? casillas[p.posicion - 1] : undefined;
    if (c) Object.assign(c, { estado: 'ocupada', folio: p.folio, conSaldo: p.conSaldo });
  }
  return { casillas, ocupadas: casillas.filter((c) => c.estado !== 'libre').length };
}
