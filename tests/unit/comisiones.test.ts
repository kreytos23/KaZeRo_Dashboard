import { describe, expect, it } from 'vitest';
import {
  comisionCentavos,
  finDeMes,
  mesAbierto,
  mesCerrable,
  mesDe,
  mesSiguiente,
  nombreMes,
  resumenPorVendedora,
  type LineaComision,
} from '@/domain/comisiones';

describe('meses', () => {
  it('mesDe lleva la fecha al día 1', () => {
    expect(mesDe('2026-11-29')).toBe('2026-11-01');
  });
  it.each([
    ['2026-01-01', '2026-01-31'],
    ['2026-11-01', '2026-11-30'],
    ['2026-02-01', '2026-02-28'],
    ['2028-02-01', '2028-02-29'],
  ])('finDeMes(%s) = %s', (mes, fin) => expect(finDeMes(mes)).toBe(fin));
  it('mesSiguiente cruza de diciembre a enero', () => {
    expect(mesSiguiente('2026-12-01')).toBe('2027-01-01');
    expect(mesSiguiente('2026-03-01')).toBe('2026-04-01');
  });
  it('un mes solo se cierra cuando ya terminó', () => {
    expect(mesCerrable('2026-11-01', '2026-11-30')).toBe(false);
    expect(mesCerrable('2026-11-01', '2026-12-01')).toBe(true);
  });
  it('nombreMes', () => {
    expect(nombreMes('2026-11-01')).toBe('Noviembre 2026');
    expect(nombreMes('2027-01-01')).toBe('Enero 2027');
  });
});

describe('mesAbierto', () => {
  it('sin cierres ni liquidaciones es el mes de hoy', () => {
    expect(mesAbierto({ ultimoCerrado: null, liquidacionMasAntigua: null, hoy: '2026-11-15' })).toBe(
      '2026-11-01',
    );
  });
  it('tras un cierre es el siguiente, aunque haya pagos atrasados', () => {
    expect(
      mesAbierto({ ultimoCerrado: '2026-10-01', liquidacionMasAntigua: '2026-09-10', hoy: '2026-11-15' }),
    ).toBe('2026-11-01');
  });
  it('sin cierres, el mes de la liquidación más antigua', () => {
    expect(mesAbierto({ ultimoCerrado: null, liquidacionMasAntigua: '2026-08-20', hoy: '2026-11-15' })).toBe(
      '2026-08-01',
    );
  });
});

describe('comisionCentavos', () => {
  it.each([
    [100000, '18.00', 18000],
    [83250, '18.00', 14985],
    [1, '50.00', 1],
    [3, '33.33', 1],
    [100000, '0', 0],
    [99999, '12.50', 12500],
  ])('%i al %s%% = %i', (base, pct, esperado) => expect(comisionCentavos(base, pct)).toBe(esperado));
  it('rechaza datos inválidos', () => {
    expect(() => comisionCentavos(100, 'abc')).toThrow();
    expect(() => comisionCentavos(-1, '10')).toThrow();
    expect(() => comisionCentavos(100, '100.01')).toThrow();
  });
});

describe('resumenPorVendedora', () => {
  const l = (
    vendedorId: string,
    vendedorNombre: string,
    pedidoId: string,
    montoCentavos: number,
    baseCentavos: number,
  ): LineaComision => ({ vendedorId, vendedorNombre, pedidoId, folio: 1, montoCentavos, baseCentavos });
  it('suma las líneas por vendedora, cuenta pedidos y ordena por nombre', () => {
    const r = resumenPorVendedora([
      l('v2', 'Zoila', 'p1', 15, 100),
      l('v1', 'Ana', 'p2', 1, 3),
      l('v1', 'Ana', 'p3', 1, 3),
      l('v1', 'Ana', 'p3', 2, 7),
    ]);
    expect(r).toEqual([
      { vendedorId: 'v1', vendedorNombre: 'Ana', pedidos: 2, baseCentavos: 13, comisionCentavos: 4 },
      { vendedorId: 'v2', vendedorNombre: 'Zoila', pedidos: 1, baseCentavos: 100, comisionCentavos: 15 },
    ]);
  });
});
