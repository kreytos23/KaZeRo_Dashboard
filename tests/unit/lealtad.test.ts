import { describe, expect, it } from 'vitest';
import {
  REGLAS_LEALTAD,
  armarTarjeta,
  conPrevias,
  descuentoLealtad,
  siguientePosicion as siguienteConVencimiento,
  tarjetaVencida,
  ultimaCompra,
  type Posicion,
} from '@/domain/lealtad';

const pos = (ciclo: number, ...posiciones: number[]) => posiciones.map((posicion) => ({ ciclo, posicion }));
const diez = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Sin compras que venzan: las reglas de siempre. */
const siguientePosicion = (o: readonly Posicion[], reglas = REGLAS_LEALTAD) =>
  siguienteConVencimiento(o, { ultimaCompra: null, fecha: '2026-11-24' }, reglas);

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

describe('compras previas (L-1 a L-3)', () => {
  const siguiente = (previas: number, ...ocupadas: number[]) =>
    siguientePosicion(conPrevias(pos(1, ...ocupadas), previas));
  it('L-2: con 4 previas la primera nota va al 5 (10 %)', () => {
    expect(siguiente(4)).toEqual({ ciclo: 1, posicion: 5 });
    expect(descuentoLealtad({ cuentaTarjeta: true, posicion: 5 })).toEqual({ pctBps: 1000 });
  });
  it('L-2: con 9 previas va al 10, y después empieza la tarjeta 2', () => {
    expect(siguiente(9)).toEqual({ ciclo: 1, posicion: 10 });
    expect(siguiente(9, 10)).toEqual({ ciclo: 2, posicion: 1 });
  });
  it('L-3: cancelar una nota nueva libera solo su lugar', () => {
    expect(siguiente(4, 6)).toEqual({ ciclo: 1, posicion: 5 });
  });
  it('los previos no cuentan en la tarjeta 2', () => {
    expect(siguientePosicion(conPrevias([...pos(1, 5, 6, 7, 8, 9, 10), ...pos(2, 1)], 4))).toEqual({
      ciclo: 2,
      posicion: 2,
    });
  });
  it('sin previas no cambia nada', () => {
    expect(conPrevias(pos(1, 1, 2), 0)).toEqual(pos(1, 1, 2));
  });
});

describe('armarTarjeta con compras previas', () => {
  it('los previos se ven como «previa» en la primera tarjeta y cuentan como ocupados', () => {
    const t = armarTarjeta([{ ciclo: 1, posicion: 5, estado: 'abierto', folio: 100, conSaldo: true }], 4);
    expect(t.casillas.slice(0, 4).every((c) => c.estado === 'previa' && c.folio === null)).toBe(true);
    expect(t.casillas[4]).toMatchObject({ estado: 'ocupada', folio: 100, pctBps: 1000 });
    expect(t.ocupadas).toBe(5);
  });
  it('en la tarjeta 2 ya no aparecen', () => {
    const t = armarTarjeta([{ ciclo: 2, posicion: 1, estado: 'abierto', folio: 110, conSaldo: false }], 4);
    expect(t.casillas.some((c) => c.estado === 'previa')).toBe(false);
    expect(t.ocupadas).toBe(1);
  });
  it('sin notas: la tarjeta 1 con los previos', () => {
    expect(armarTarjeta([], 3).ocupadas).toBe(3);
  });
});

describe('tarjetaVencida (L-7: 6 meses o más sin comprar)', () => {
  it('el mismo día seis meses después ya vence', () => {
    expect(tarjetaVencida('2026-05-17', '2026-11-17')).toBe(true);
  });
  it('un día antes sigue vigente', () => {
    expect(tarjetaVencida('2026-05-17', '2026-11-16')).toBe(false);
  });
  it('31 de agosto + 6 meses es el 28 de febrero (como Postgres)', () => {
    expect(tarjetaVencida('2026-08-31', '2027-02-27')).toBe(false);
    expect(tarjetaVencida('2026-08-31', '2027-02-28')).toBe(true);
  });
  it('año bisiesto: 31 de agosto de 2027 vence el 29 de febrero de 2028', () => {
    expect(tarjetaVencida('2027-08-31', '2028-02-28')).toBe(false);
    expect(tarjetaVencida('2027-08-31', '2028-02-29')).toBe(true);
  });
  it('sin compras no hay nada que vencer', () => {
    expect(tarjetaVencida(null, '2030-01-01')).toBe(false);
  });
  it('una nota con fecha anterior a la última compra no la vence', () => {
    expect(tarjetaVencida('2026-11-17', '2026-01-01')).toBe(false);
  });
});

describe('ultimaCompra', () => {
  it('la fecha más reciente de las notas, ignorando las vacías', () => {
    expect(ultimaCompra(['2026-03-01', null, '2026-07-09', undefined, '2026-05-30'], null)).toBe(
      '2026-07-09',
    );
  });
  it('sin notas que cuenten → la fecha de las compras previas', () => {
    expect(ultimaCompra([], '2026-11-17')).toBe('2026-11-17');
    expect(ultimaCompra([null, undefined], '2026-11-17')).toBe('2026-11-17');
  });
  it('con alguna nota, la fecha de las previas se ignora aunque sea más reciente', () => {
    expect(ultimaCompra(['2026-03-01'], '2026-11-17')).toBe('2026-03-01');
  });
  it('con alguna nota, la fecha de las previas se ignora aunque sea más antigua', () => {
    expect(ultimaCompra(['2026-03-01'], '2025-01-10')).toBe('2026-03-01');
  });
  it('sin notas ni previas → null', () => {
    expect(ultimaCompra([], null)).toBeNull();
    expect(ultimaCompra([null], undefined)).toBeNull();
  });
});

describe('siguientePosicion con vencimiento (L-7)', () => {
  const vence = { ultimaCompra: '2026-05-17', fecha: '2026-11-17' };
  const vigente = { ultimaCompra: '2026-05-17', fecha: '2026-11-16' };
  it('si venció, la nota empieza la tarjeta siguiente en la compra 1 (sin descuento)', () => {
    expect(siguienteConVencimiento(pos(1, 1, 2, 3, 4), vence)).toEqual({ ciclo: 2, posicion: 1 });
    expect(descuentoLealtad({ cuentaTarjeta: true, posicion: 1 })).toEqual({ pctBps: 0 });
  });
  it('un día antes sigue en su tarjeta', () => {
    expect(siguienteConVencimiento(pos(1, 1, 2, 3, 4), vigente)).toEqual({ ciclo: 1, posicion: 5 });
  });
  it('las compras previas cuentan como la vuelta 1: se pierden y empieza la 2', () => {
    expect(siguienteConVencimiento(conPrevias([], 4), vence)).toEqual({ ciclo: 2, posicion: 1 });
  });
  it('desde una vuelta alta, la siguiente; un hueco cancelado de la vencida no se reutiliza', () => {
    expect(siguienteConVencimiento([...pos(2, ...diez), ...pos(3, 1, 3)], vence)).toEqual({
      ciclo: 4,
      posicion: 1,
    });
  });
  it('sin compras: vuelta 1, compra 1', () => {
    expect(siguienteConVencimiento([], { ultimaCompra: null, fecha: '2026-11-17' })).toEqual({
      ciclo: 1,
      posicion: 1,
    });
  });
});
