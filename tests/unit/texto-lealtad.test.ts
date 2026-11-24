import { describe, expect, it } from 'vitest';
import { armarTarjeta } from '@/domain/lealtad';
import {
  avisoVencimiento,
  etiquetaCasilla,
  pieTarjeta,
  textoLealtadGuardada,
  textoLealtadPrevia,
} from '@/features/pedidos/texto-lealtad';
import type { TarjetaPrevia } from '@/features/pedidos/tipos';

const tarjeta = (extra: Partial<TarjetaPrevia> = {}): TarjetaPrevia => ({
  ciclo: 1,
  posicion: 5,
  pctBps: 1000,
  nueva: false,
  ...extra,
});

describe('textoLealtadPrevia', () => {
  it('R-22: "Pedido 5 de su tarjeta: −10 %"', () => {
    expect(textoLealtadPrevia(tarjeta(), { cuentaTarjeta: true, hayCliente: true })).toBe(
      'Pedido 5 de su tarjeta: −10 %',
    );
  });
  it('la vuelta es interna: no se menciona el ciclo', () => {
    expect(
      textoLealtadPrevia(tarjeta({ ciclo: 2, posicion: 10, pctBps: 2000 }), {
        cuentaTarjeta: true,
        hayCliente: true,
      }),
    ).toBe('Pedido 10 de su tarjeta: −20 %');
  });
  it('posición sin descuento, sin tarjeta (R-28) y sin cliente', () => {
    expect(
      textoLealtadPrevia(tarjeta({ posicion: 3, pctBps: 0 }), { cuentaTarjeta: true, hayCliente: true }),
    ).toBe('Pedido 3 de su tarjeta.');
    expect(textoLealtadPrevia(null, { cuentaTarjeta: false, hayCliente: true })).toBe(
      'No cuenta para la tarjeta de lealtad.',
    );
    expect(textoLealtadPrevia(null, { cuentaTarjeta: true, hayCliente: false })).toBe(
      'Elige un cliente para ver su tarjeta.',
    );
  });
});

describe('textoLealtadGuardada (ficha del pedido)', () => {
  const base = {
    cuentaTarjeta: true,
    cicloTarjeta: 1,
    posicionTarjeta: 5,
    descuentoLealtadPct: '10.00',
    sinLealtadMotivo: null,
  } as Parameters<typeof textoLealtadGuardada>[0];
  it('con descuento', () => expect(textoLealtadGuardada(base)).toBe('Compra 5: −10 %'));
  it('motivo histórico de la regla derogada (R-29)', () =>
    expect(
      textoLealtadGuardada({ ...base, descuentoLealtadPct: '0.00', sinLealtadMotivo: 'saldo_pendiente' }),
    ).toBe('Sin descuento (regla anterior: saldo pendiente)'));
  it('R-28', () =>
    expect(
      textoLealtadGuardada({
        ...base,
        cuentaTarjeta: false,
        cicloTarjeta: null,
        posicionTarjeta: null,
        descuentoLealtadPct: '0.00',
      }),
    ).toBe('No cuenta para la tarjeta de lealtad.'));
});

describe('etiquetaCasilla (nombre accesible de ●◐○)', () => {
  it.each([
    [{ posicion: 1, estado: 'ocupada', folio: 10, pctBps: 0, conSaldo: false }, 'Compra 1: KZR-10'],
    [
      { posicion: 5, estado: 'ocupada', folio: 12, pctBps: 1000, conSaldo: true },
      'Compra 5: KZR-12, con saldo, 10 % de descuento',
    ],
    [
      { posicion: 10, estado: 'libre', folio: null, pctBps: 2000, conSaldo: false },
      'Compra 10: libre, 20 % de descuento',
    ],
    [{ posicion: 3, estado: 'previa', folio: null, pctBps: 0, conSaldo: false }, 'Compra 3: compra anterior'],
    [
      { posicion: 5, estado: 'previa', folio: null, pctBps: 1000, conSaldo: false },
      'Compra 5: compra anterior, 10 % de descuento',
    ],
  ] as const)('%j', (c, texto) => expect(etiquetaCasilla(c)).toBe(texto));
});

describe('pieTarjeta', () => {
  const con = (n: number) =>
    armarTarjeta(
      Array.from({ length: n }, (_, i) => ({
        ciclo: 1,
        posicion: i + 1,
        estado: 'abierto' as const,
        folio: i + 1,
        conSaldo: false,
      })),
    );
  it('el pie cuenta las compras previas', () => {
    expect(pieTarjeta(armarTarjeta([], 4))).toBe('4 de 10 · falta 1 para el 10 %');
  });
  it.each([
    [0, '0 de 10 · faltan 5 para el 10 %'],
    [3, '3 de 10 · faltan 2 para el 10 %'],
    [5, '5 de 10 · faltan 5 para el 20 %'],
    [6, '6 de 10 · faltan 4 para el 20 %'],
    [9, '9 de 10 · falta 1 para el 20 %'],
    [10, '10 de 10 · tarjeta completa'],
  ])('%i ocupadas', (n, texto) => expect(pieTarjeta(con(n))).toBe(texto));
});

describe('L-7: vencimiento de la tarjeta', () => {
  it('la vista previa avisa que la nota empieza una tarjeta nueva', () => {
    expect(
      textoLealtadPrevia(tarjeta({ ciclo: 2, posicion: 1, pctBps: 0, nueva: true }), {
        cuentaTarjeta: true,
        hayCliente: true,
      }),
    ).toBe('Pedido 1 de su tarjeta nueva: la anterior venció (6 meses o más sin comprar).');
  });
  it('la ficha avisa cuando ya venció, con la fecha de la última compra', () => {
    expect(
      avisoVencimiento({ ultimaCompra: '2026-05-17', vence: '2026-11-17', vencida: true }, armarTarjeta([])),
    ).toBe(
      'Tarjeta vencida: 6 meses o más sin comprar (última compra: 17 de mayo de 2026). Su próxima nota empieza una tarjeta nueva.',
    );
  });
  it('si no ha vencido, dice cuándo vence, solo con alguna compra en la tarjeta actual', () => {
    const v = { ultimaCompra: '2026-10-02', vence: '2027-04-02', vencida: false };
    expect(avisoVencimiento(v, armarTarjeta([], 2))).toBe('Vence el 2 de abril de 2027.');
    expect(avisoVencimiento(v, armarTarjeta([]))).toBeNull();
  });
  it('con la tarjeta llena no dice cuándo vence: la siguiente nota ya empieza otra', () => {
    const v = { ultimaCompra: '2026-10-02', vence: '2027-04-02', vencida: false };
    expect(avisoVencimiento(v, armarTarjeta([], 9))).toBe('Vence el 2 de abril de 2027.');
    const llena = armarTarjeta(
      [{ ciclo: 1, posicion: 10, estado: 'liquidado', folio: 7, conSaldo: false }],
      9,
    );
    expect(avisoVencimiento(v, llena)).toBeNull();
  });
  it('sin compras no hay aviso', () => {
    expect(
      avisoVencimiento({ ultimaCompra: null, vence: null, vencida: false }, armarTarjeta([])),
    ).toBeNull();
  });
});
