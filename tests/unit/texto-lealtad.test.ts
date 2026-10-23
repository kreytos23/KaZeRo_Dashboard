import { describe, expect, it } from 'vitest';
import { etiquetaCasilla, textoLealtadGuardada, textoLealtadPrevia } from '@/features/pedidos/texto-lealtad';
import type { TarjetaPrevia } from '@/features/pedidos/tipos';

const tarjeta = (extra: Partial<TarjetaPrevia> = {}): TarjetaPrevia => ({
  ciclo: 1,
  posicion: 5,
  pctBps: 1000,
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
  it('con descuento', () => expect(textoLealtadGuardada(base)).toBe('Lugar 5: −10 %'));
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
    [{ posicion: 1, estado: 'ocupada', folio: 10, pctBps: 0, conSaldo: false }, 'Lugar 1: KZR-10'],
    [
      { posicion: 5, estado: 'ocupada', folio: 12, pctBps: 1000, conSaldo: true },
      'Lugar 5: KZR-12, con saldo, 10 % de descuento',
    ],
    [
      { posicion: 10, estado: 'libre', folio: null, pctBps: 2000, conSaldo: false },
      'Lugar 10: libre, 20 % de descuento',
    ],
  ] as const)('%j', (c, texto) => expect(etiquetaCasilla(c)).toBe(texto));
});
