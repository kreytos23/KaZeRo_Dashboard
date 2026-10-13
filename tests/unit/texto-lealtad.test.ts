import { describe, expect, it } from 'vitest';
import { etiquetaCasilla, textoLealtadGuardada, textoLealtadPrevia } from '@/features/pedidos/texto-lealtad';
import type { TarjetaPrevia } from '@/features/pedidos/tipos';

const tarjeta = (extra: Partial<TarjetaPrevia> = {}): TarjetaPrevia => ({
  ciclo: 1,
  posicion: 5,
  pctBps: 1000,
  sinLealtad: null,
  foliosConSaldo: [],
  ...extra,
});

describe('textoLealtadPrevia', () => {
  it('R-22: "Pedido 5 de su tarjeta: −10 %"', () => {
    expect(textoLealtadPrevia(tarjeta(), { cuentaTarjeta: true, hayCliente: true })).toBe(
      'Pedido 5 de su tarjeta: −10 %',
    );
  });
  it('R-22 en otro ciclo dice el ciclo', () => {
    expect(
      textoLealtadPrevia(tarjeta({ ciclo: 2, posicion: 10, pctBps: 2000 }), {
        cuentaTarjeta: true,
        hayCliente: true,
      }),
    ).toBe('Pedido 10 de su tarjeta (ciclo 2): −20 %');
  });
  it('R-29: explica por qué no hay descuento, con los folios', () => {
    expect(
      textoLealtadPrevia(tarjeta({ pctBps: 0, sinLealtad: 'saldo_pendiente', foliosConSaldo: [12, 15] }), {
        cuentaTarjeta: true,
        hayCliente: true,
      }),
    ).toBe('Pedido 5 de su tarjeta: sin descuento porque tiene saldo pendiente en KZR-12, KZR-15.');
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
  it('con descuento', () => expect(textoLealtadGuardada(base)).toBe('Posición 5 del ciclo 1: −10 %'));
  it('R-29 guardado', () =>
    expect(
      textoLealtadGuardada({ ...base, descuentoLealtadPct: '0.00', sinLealtadMotivo: 'saldo_pendiente' }),
    ).toBe('Posición 5 del ciclo 1: sin descuento porque al crearlo tenía otra nota con saldo pendiente.'));
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
    [{ posicion: 1, estado: 'contada', folio: 10, pctBps: 0 }, 'Posición 1: contada, KZR-10'],
    [
      { posicion: 5, estado: 'apartada', folio: 12, pctBps: 1000 },
      'Posición 5: apartada, KZR-12, 10 % de descuento',
    ],
    [{ posicion: 10, estado: 'libre', folio: null, pctBps: 2000 }, 'Posición 10: libre, 20 % de descuento'],
  ] as const)('%j', (c, texto) => expect(etiquetaCasilla(c)).toBe(texto));
});
