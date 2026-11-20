import { describe, expect, it } from 'vitest';
import { importesConDescuento } from '@/domain/devolucion';
import { periodoDeUrl, resumirLineas, top5 } from '@/domain/resumen';

const HOY = '2026-11-07';

describe('periodoDeUrl', () => {
  it('por omisión es este mes hasta hoy', () => {
    expect(periodoDeUrl({}, HOY)).toEqual({ clave: 'mes', desde: '2026-11-01', hasta: HOY, invalido: false });
  });
  it('mes anterior completo, cruzando el año', () => {
    expect(periodoDeUrl({ periodo: 'anterior' }, HOY)).toMatchObject({
      desde: '2026-10-01',
      hasta: '2026-10-31',
    });
    expect(periodoDeUrl({ periodo: 'anterior' }, '2026-01-15')).toMatchObject({
      desde: '2025-12-01',
      hasta: '2025-12-31',
    });
  });
  it('este año hasta hoy', () => {
    expect(periodoDeUrl({ periodo: 'anio' }, HOY)).toMatchObject({ desde: '2026-01-01', hasta: HOY });
  });
  it('rango válido', () => {
    expect(periodoDeUrl({ periodo: 'rango', desde: '2026-03-01', hasta: '2026-03-15' }, HOY)).toEqual({
      clave: 'rango',
      desde: '2026-03-01',
      hasta: '2026-03-15',
      invalido: false,
    });
  });
  it.each([
    [{ desde: '2026-02-30', hasta: '2026-03-01' }],
    [{ desde: '2026-03-02', hasta: '2026-03-01' }],
    [{ desde: 'x', hasta: '2026-03-01' }],
    [{ desde: '2026-03-01' }],
  ])('rango inválido vuelve a este mes con aviso: %j', (r) => {
    expect(periodoDeUrl({ periodo: 'rango', ...r }, HOY)).toEqual({
      clave: 'mes',
      desde: '2026-11-01',
      hasta: HOY,
      invalido: true,
    });
  });
  it('un periodo desconocido es este mes, sin aviso', () => {
    expect(periodoDeUrl({ periodo: 'nada' }, HOY)).toMatchObject({ clave: 'mes', invalido: false });
  });
});

// M-3 / I-1: el Resumen calcula los importes con el mismo reparto que la devolución (`repartirDescuentoManual`).
describe('importesConDescuento', () => {
  it('sin descuento no cambia nada', () => {
    expect(importesConDescuento([1000, 2000], 0)).toEqual([1000, 2000]);
  });
  it('reparte en proporción', () => {
    expect(importesConDescuento([10000, 30000], 4000)).toEqual([9000, 27000]);
  });
  it('los centavos sobrantes no se pierden: la suma es exacta y el empate va a la primera línea', () => {
    const r = importesConDescuento([1000, 1000, 1000], 100);
    expect(r.reduce((a, b) => a + b, 0)).toBe(2900);
    expect(r).toEqual([966, 967, 967]);
    expect(importesConDescuento([10000, 10000], 1001)).toEqual([9499, 9500]);
  });
  it('nota con total 0', () => {
    expect(importesConDescuento([1000, 500], 1500)).toEqual([0, 0]);
    expect(importesConDescuento([0, 0], 0)).toEqual([0, 0]);
  });
  it('rechaza un descuento mayor que la suma', () => {
    expect(() => importesConDescuento([1000], 1001)).toThrow(RangeError);
  });
});

describe('resumirLineas', () => {
  const l = (importe: number, costo: number, categoria = 'Aretes', devuelta = false) => ({
    importe,
    costo,
    categoria,
    devuelta,
  });
  it('M-4: margen solo de piezas con costo, con aviso de las demás', () => {
    expect(resumirLineas([l(10000, 4000), l(5000, 0)])).toMatchObject({
      margenCentavos: 6000,
      baseMargenCentavos: 10000,
      piezasSinCosto: 1,
    });
  });
  it('las devueltas no cuentan en nada', () => {
    const r = resumirLineas([l(10000, 4000, 'Aretes', true), l(5000, 0, 'Aretes', true)]);
    expect(r).toMatchObject({ margenCentavos: 0, baseMargenCentavos: 0, piezasSinCosto: 0 });
    expect(r.categorias.size).toBe(0);
  });
  it('M-5: categorías por importe, incluidas las piezas sin costo', () => {
    const r = resumirLineas([l(10000, 4000, 'Aretes'), l(5000, 0, 'Aretes'), l(2000, 500, 'Anillos')]);
    expect([...r.categorias]).toEqual([
      ['Aretes', 15000],
      ['Anillos', 2000],
    ]);
  });
});

describe('top5', () => {
  it('ordena, corta a 5 y desempata por nombre', () => {
    const filas = [
      ['b', 10],
      ['a', 10],
      ['c', 30],
      ['d', 1],
      ['e', 2],
      ['f', 3],
    ].map(([nombre, centavos]) => ({ nombre: nombre as string, centavos: centavos as number }));
    expect(top5(filas).map((x) => x.nombre)).toEqual(['c', 'a', 'b', 'f', 'e']);
  });
  it('m-1: dos homónimas son dos filas, en orden estable por id', () => {
    const r = top5([
      { id: 'id-2', nombre: 'Ana Ejemplo', centavos: 500 },
      { id: 'id-1', nombre: 'Ana Ejemplo', centavos: 500 },
    ]);
    expect(r.map((x) => x.id)).toEqual(['id-1', 'id-2']);
  });
});
