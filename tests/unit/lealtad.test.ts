import { describe, expect, it } from 'vitest';
import { REGLAS_LEALTAD, armarTarjeta, descuentoLealtad, siguientePosicion } from '@/domain/lealtad';

const pos = (ciclo: number, ...posiciones: number[]) => posiciones.map((posicion) => ({ ciclo, posicion }));

describe('siguientePosicion', () => {
  it('R-23: un cliente sin pedidos empieza en ciclo 1, posición 1', () => {
    expect(siguientePosicion([])).toEqual({ ciclo: 1, posicion: 1 });
  });
  it('R-23: con 4 posiciones ocupadas toma la 5', () => {
    expect(siguientePosicion(pos(1, 1, 2, 3, 4))).toEqual({ ciclo: 1, posicion: 5 });
  });
  it('R-23: el orden de llegada de las ocupadas no importa', () => {
    expect(siguientePosicion(pos(1, 4, 2, 1, 3))).toEqual({ ciclo: 1, posicion: 5 });
  });
  it('R-24: un hueco por cancelación se llena primero', () => {
    expect(siguientePosicion(pos(1, 1, 2, 3, 4, 6, 7))).toEqual({ ciclo: 1, posicion: 5 });
  });
  it('R-26: con las 10 apartadas inicia un ciclo nuevo en la 1', () => {
    expect(siguientePosicion(pos(1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10))).toEqual({ ciclo: 2, posicion: 1 });
  });
  it('R-24 + P4: un hueco en un ciclo anterior se llena antes que el ciclo actual', () => {
    const ocupadas = [...pos(1, 1, 2, 3, 4, 5, 6, 8, 9, 10), ...pos(2, 1, 2)];
    expect(siguientePosicion(ocupadas)).toEqual({ ciclo: 1, posicion: 7 });
  });
  it('R-21: respeta el tamaño de ciclo de las reglas', () => {
    expect(siguientePosicion(pos(1, 1, 2, 3), { ...REGLAS_LEALTAD, tamanoCiclo: 3 })).toEqual({
      ciclo: 2,
      posicion: 1,
    });
  });
});

describe('descuentoLealtad', () => {
  const base = { cuentaTarjeta: true, otraNotaConSaldo: false };
  it.each([
    [1, 0],
    [4, 0],
    [5, 1000],
    [6, 0],
    [9, 0],
    [10, 2000],
  ])('R-22: posición %i → %i centésimas de punto', (posicion, pctBps) => {
    expect(descuentoLealtad({ ...base, posicion })).toEqual({ pctBps, sinLealtad: null });
  });
  it('R-28: si no cuenta para tarjeta no hay descuento ni motivo', () => {
    expect(descuentoLealtad({ cuentaTarjeta: false, posicion: null, otraNotaConSaldo: true })).toEqual({
      pctBps: 0,
      sinLealtad: null,
    });
  });
  it('R-29: en la 5 con otra nota con saldo → sin descuento y con motivo', () => {
    expect(descuentoLealtad({ ...base, posicion: 5, otraNotaConSaldo: true })).toEqual({
      pctBps: 0,
      sinLealtad: 'saldo_pendiente',
    });
  });
  it('R-29: en la 10 con otra nota con saldo → sin descuento y con motivo', () => {
    expect(descuentoLealtad({ ...base, posicion: 10, otraNotaConSaldo: true }).sinLealtad).toBe(
      'saldo_pendiente',
    );
  });
  it('R-29: en una posición sin descuento el saldo pendiente no deja motivo', () => {
    expect(descuentoLealtad({ ...base, posicion: 6, otraNotaConSaldo: true })).toEqual({
      pctBps: 0,
      sinLealtad: null,
    });
  });
});

describe('armarTarjeta', () => {
  it('R-25: ● contada (liquidado), ◐ apartada (abierto), ○ libre, con el % de cada casilla', () => {
    const [c1] = armarTarjeta([
      { ciclo: 1, posicion: 1, estado: 'liquidado', folio: 10 },
      { ciclo: 1, posicion: 2, estado: 'abierto', folio: 12 },
    ]);
    expect(c1!.ciclo).toBe(1);
    expect(c1!.contadas).toBe(1);
    expect(c1!.casillas.map((c) => c.estado)).toEqual([
      'contada',
      'apartada',
      'libre',
      'libre',
      'libre',
      'libre',
      'libre',
      'libre',
      'libre',
      'libre',
    ]);
    expect(c1!.casillas[0]).toMatchObject({ folio: 10 });
    expect(c1!.casillas[4]).toMatchObject({ posicion: 5, pctBps: 1000, folio: null });
    expect(c1!.casillas[9]).toMatchObject({ posicion: 10, pctBps: 2000 });
  });
  it('sin pedidos muestra un ciclo vacío; con ciclo 2 muestra ambos', () => {
    expect(armarTarjeta([])).toHaveLength(1);
    const ciclos = armarTarjeta([{ ciclo: 2, posicion: 1, estado: 'abierto', folio: 40 }]);
    expect(ciclos.map((c) => c.ciclo)).toEqual([1, 2]);
    expect(ciclos[1]!.casillas[0]!.estado).toBe('apartada');
  });
  it('ignora posiciones fuera del ciclo (datos viejos) en vez de romper', () => {
    expect(() => armarTarjeta([{ ciclo: 1, posicion: 11, estado: 'liquidado', folio: 1 }])).not.toThrow();
  });
});
