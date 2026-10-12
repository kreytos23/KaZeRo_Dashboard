import { describe, expect, it } from 'vitest';
import {
  calcularTotales,
  descuentoLinea,
  esFolioExplicito,
  formatoFolio,
  formatoPct,
  numericAPctBps,
  parsearFolio,
  pctBpsANumeric,
} from '@/domain/pedidos';

describe('descuentoLinea (redondeo mitad hacia arriba por línea)', () => {
  it.each([
    [14900, 1000, 1490],
    [14950, 1000, 1495],
    [14955, 1000, 1496], // 1495.5 → 1496
    [14945, 1000, 1495], // 1494.5 → 1495
    [999, 2000, 200], // 199.8 → 200
    [0, 2000, 0],
    [14900, 0, 0],
  ])('%i centavos al %i bps → %i', (precio, bps, esperado) => {
    expect(descuentoLinea(precio, bps)).toBe(esperado);
  });
  it('no pierde precisión con el precio máximo de numeric(12,2)', () => {
    expect(descuentoLinea(999_999_999_999, 2000)).toBe(200_000_000_000);
  });
});

describe('calcularTotales', () => {
  it('R-12: sin descuentos el total es el subtotal', () => {
    expect(calcularTotales([14900, 25000], 0, 0)).toEqual({
      subtotal: 39900,
      descuentoLealtad: 0,
      preciosFinales: [14900, 25000],
      descuentoManual: 0,
      total: 39900,
      manualExcede: false,
    });
  });
  it('R-12 + R-22: lealtad por línea, luego manual (R-13 acumulable)', () => {
    const t = calcularTotales([14955, 14945], 1000, 5000);
    expect(t.preciosFinales).toEqual([13459, 13450]);
    expect(t.descuentoLealtad).toBe(2991);
    expect(t.total).toBe(29900 - 2991 - 5000);
    expect(t.manualExcede).toBe(false);
  });
  it('R-12: la suma de los descuentos por línea es exactamente el descuento de lealtad', () => {
    const precios = [14955, 14945, 999, 1, 33333];
    const t = calcularTotales(precios, 1000, 0);
    const porLinea = precios.reduce((a, p) => a + descuentoLinea(p, 1000), 0);
    expect(t.descuentoLealtad).toBe(porLinea);
    expect(t.subtotal - t.preciosFinales.reduce((a, b) => a + b, 0)).toBe(porLinea);
  });
  it('R-12: el descuento manual igual a lo que queda deja el total en 0', () => {
    const t = calcularTotales([10000], 2000, 8000);
    expect(t).toMatchObject({ total: 0, manualExcede: false });
  });
  it('R-12: el total nunca es negativo; un manual mayor se marca como excedido', () => {
    const t = calcularTotales([10000], 2000, 8001);
    expect(t).toMatchObject({ total: 0, manualExcede: true });
  });
  it('rechaza montos inválidos (programación)', () => {
    expect(() => calcularTotales([-1], 0, 0)).toThrow(RangeError);
    expect(() => calcularTotales([100], 0, -1)).toThrow(RangeError);
    expect(() => calcularTotales([100], 10001, 0)).toThrow(RangeError);
  });
});

describe('folios y porcentajes', () => {
  it('formatoFolio', () => expect(formatoFolio(31)).toBe('KZR-31'));
  it.each([
    ['KZR-31', 31],
    ['kzr31', 31],
    [' kzr 31 ', 31],
    ['31', 31],
    ['KZR-0', null],
    ['KZR-', null],
    ['AF12', null],
    ['31a', null],
  ])('parsearFolio(%j) → %j', (t, n) => expect(parsearFolio(t)).toBe(n));
  it('esFolioExplicito distingue "KZR-34" de "34"', () => {
    expect(esFolioExplicito('kzr-34')).toBe(true);
    expect(esFolioExplicito('34')).toBe(false);
  });
  it('porcentajes en centésimas de punto', () => {
    expect(numericAPctBps('10.00')).toBe(1000);
    expect(numericAPctBps('12.5')).toBe(1250);
    expect(pctBpsANumeric(2000)).toBe('20.00');
    expect(formatoPct(1000)).toBe('10 %');
    expect(formatoPct(1250)).toBe('12.5 %');
  });
});

describe('validación de entradas (RangeError)', () => {
  it.each([
    [1.5, 1000],
    [-1, 1000],
    [Number.NaN, 1000],
    [Number.MAX_SAFE_INTEGER + 1, 1000],
    [100, -1],
    [100, 10001],
    [100, 0.5],
  ])('descuentoLinea(%s, %s) lanza RangeError', (p, b) => {
    expect(() => descuentoLinea(p, b)).toThrow(RangeError);
  });
  it('el subtotal fuera del rango seguro lanza RangeError', () => {
    expect(() => calcularTotales([Number.MAX_SAFE_INTEGER, 1], 0, 0)).toThrow(RangeError);
  });
});
