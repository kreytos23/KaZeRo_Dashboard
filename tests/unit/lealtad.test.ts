import { describe, expect, it } from 'vitest';
import { REGLAS_LEALTAD, armarTarjeta, descuentoLealtad, siguientePosicion } from '@/domain/lealtad';

const pos = (ciclo: number, ...posiciones: number[]) => posiciones.map((posicion) => ({ ciclo, posicion }));
const diez = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('siguientePosicion (10 lugares, D-2)', () => {
  it('R-23: sin pedidos → vuelta 1, lugar 1', () => {
    expect(siguientePosicion([])).toEqual({ ciclo: 1, posicion: 1 });
  });
  it('R-23: con 4 posiciones ocupadas toma la 5', () => {
    expect(siguientePosicion(pos(1, 1, 2, 3, 4))).toEqual({ ciclo: 1, posicion: 5 });
  });
  it('R-23: el orden de llegada de las ocupadas no importa', () => {
    expect(siguientePosicion(pos(1, 4, 2, 1, 3))).toEqual({ ciclo: 1, posicion: 5 });
  });
  it('R-24: un hueco por cancelación en la tarjeta actual se llena primero (P1)', () => {
    expect(siguientePosicion(pos(1, 1, 2, 4, 5, 6))).toEqual({ ciclo: 1, posicion: 3 });
  });
  it('R-26: con los 10 ocupados empieza una tarjeta nueva en el 1', () => {
    expect(siguientePosicion(pos(1, ...diez))).toEqual({ ciclo: 2, posicion: 1 });
  });
  it('R-24: un hueco de una tarjeta anterior NO se rellena', () => {
    const ocupadas = [...pos(1, 1, 2, 3, 4, 5, 6, 8, 9, 10), ...pos(2, 1, 2)];
    expect(siguientePosicion(ocupadas)).toEqual({ ciclo: 2, posicion: 3 });
  });
  it('R-24: cancelar el lugar 10 de la tarjeta actual lo deja libre para el siguiente (recibe 20 %)', () => {
    expect(siguientePosicion(pos(1, 1, 2, 3, 4, 5, 6, 7, 8, 9))).toEqual({ ciclo: 1, posicion: 10 });
  });
  it('R-24: si se cancela lo único de la tarjeta nueva, la anterior llena vuelve a ser la actual', () => {
    expect(siguientePosicion(pos(1, ...diez))).toEqual({ ciclo: 2, posicion: 1 });
  });
  it('R-21: respeta el tamaño de ciclo de las reglas', () => {
    expect(siguientePosicion(pos(1, 1, 2, 3), { ...REGLAS_LEALTAD, tamanoCiclo: 3 })).toEqual({
      ciclo: 2,
      posicion: 1,
    });
  });
});

describe('descuentoLealtad sin R-29 (D-5)', () => {
  it.each([
    [1, 0],
    [4, 0],
    [5, 1000],
    [6, 0],
    [9, 0],
    [10, 2000],
  ])('R-22: posición %i → %i centésimas de punto', (posicion, pctBps) => {
    expect(descuentoLealtad({ cuentaTarjeta: true, posicion })).toEqual({ pctBps });
  });
  it('R-28: si no cuenta para tarjeta no hay descuento', () => {
    expect(descuentoLealtad({ cuentaTarjeta: false, posicion: null })).toEqual({ pctBps: 0 });
    expect(descuentoLealtad({ cuentaTarjeta: false, posicion: 5 })).toEqual({ pctBps: 0 });
  });
});

describe('armarTarjeta (R-25, D-4)', () => {
  it('solo la tarjeta actual; abiertos y liquidados cuentan igual; marca con saldo', () => {
    const t = armarTarjeta([
      ...diez.map((posicion) => ({
        ciclo: 1,
        posicion,
        estado: 'liquidado' as const,
        folio: posicion,
        conSaldo: false,
      })),
      { ciclo: 2, posicion: 1, estado: 'liquidado', folio: 11, conSaldo: false },
      { ciclo: 2, posicion: 2, estado: 'abierto', folio: 12, conSaldo: true },
    ]);
    expect(t.ocupadas).toBe(2);
    expect(t.casillas).toHaveLength(10);
    expect(t.casillas[1]).toMatchObject({ estado: 'ocupada', folio: 12, conSaldo: true });
    expect(t.casillas[4]).toMatchObject({ estado: 'libre', pctBps: 1000 });
    expect(t.casillas[9]).toMatchObject({ posicion: 10, pctBps: 2000, folio: null });
  });
  it('con la tarjeta actual llena se ve llena (10/10) hasta el siguiente pedido', () => {
    const t = armarTarjeta(
      diez.map((posicion) => ({
        ciclo: 3,
        posicion,
        estado: 'abierto' as const,
        folio: posicion,
        conSaldo: false,
      })),
    );
    expect(t.ocupadas).toBe(10);
  });
  it('sin pedidos muestra una tarjeta vacía', () => {
    const t = armarTarjeta([]);
    expect(t.ocupadas).toBe(0);
    expect(t.casillas.every((c) => c.estado === 'libre')).toBe(true);
  });
  it('ignora posiciones fuera de la tarjeta (datos viejos) en vez de romper', () => {
    expect(() =>
      armarTarjeta([{ ciclo: 1, posicion: 11, estado: 'liquidado', folio: 1, conSaldo: false }]),
    ).not.toThrow();
  });
});
