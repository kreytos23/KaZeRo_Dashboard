import { centavosANumeric, numericACentavos } from './dinero';

export const MAX_PIEZAS_PEDIDO = 100;
const BPS_MAX = 10_000;

/**
 * Descuento de una línea: precio × bps / 10000, redondeado a centavos mitad hacia arriba (convención de
 * reglas-de-negocio: "en cada línea"). BigInt porque precio máximo × 10000 rebasa Number.MAX_SAFE_INTEGER.
 */
export function descuentoLinea(precioCentavos: number, pctBps: number): number {
  return Number((BigInt(precioCentavos) * BigInt(pctBps) + 5000n) / 10000n);
}

export interface Totales {
  subtotal: number;
  descuentoLealtad: number;
  preciosFinales: number[];
  descuentoManual: number;
  total: number;
  /** El manual supera lo que queda tras la lealtad: el servicio lo rechaza (D-7); la UI avisa. */
  manualExcede: boolean;
}

/** R-12: subtotal → − lealtad (% por línea, R-22) → − manual (acumulable, R-13). El total nunca es negativo. */
export function calcularTotales(
  precios: readonly number[],
  pctBps: number,
  descuentoManual: number,
): Totales {
  const entero = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (
    !precios.every(entero) ||
    !entero(descuentoManual) ||
    !Number.isInteger(pctBps) ||
    pctBps < 0 ||
    pctBps > BPS_MAX
  )
    throw new RangeError('Montos o porcentaje inválidos.');
  const preciosFinales = precios.map((p) => p - descuentoLinea(p, pctBps));
  const subtotal = precios.reduce((a, b) => a + b, 0);
  const despuesLealtad = preciosFinales.reduce((a, b) => a + b, 0);
  return {
    subtotal,
    descuentoLealtad: subtotal - despuesLealtad,
    preciosFinales,
    descuentoManual,
    total: Math.max(0, despuesLealtad - descuentoManual),
    manualExcede: descuentoManual > despuesLealtad,
  };
}

export function formatoFolio(folio: number): string {
  return `KZR-${folio}`;
}

/** "KZR-31", "kzr31", "kzr 31" o "31" → 31. Cero o basura → null. */
export function parsearFolio(t: string): number | null {
  const m = /^\s*(?:kzr[\s-]*)?(\d{1,9})\s*$/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** "KZR-34" siempre es folio; "34" puede ser también un código de pieza (D-16). */
export function esFolioExplicito(t: string): boolean {
  return /^\s*kzr/i.test(t) && parsearFolio(t) !== null;
}

/** numeric(5,2) ↔ centésimas de punto: '10.00' ↔ 1000 (misma aritmética que los centavos). */
export const numericAPctBps = (n: string): number => numericACentavos(n);
export const pctBpsANumeric = (bps: number): string => centavosANumeric(bps);

export function formatoPct(bps: number): string {
  return `${(bps / 100).toString()} %`;
}
