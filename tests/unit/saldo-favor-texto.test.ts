import { describe, expect, it } from 'vitest';
import { montoConSigno, textoMovimientoSaldo } from '@/features/saldo-favor/texto';

const base = { pedidoFolio: null, devolucionMotivo: null, nota: null };

describe('textoMovimientoSaldo', () => {
  it('cancelación: nombra el pedido cancelado', () =>
    expect(textoMovimientoSaldo({ ...base, tipo: 'cancelacion', pedidoFolio: 3 })).toBe(
      'Cancelación de KZR-3',
    ));
  it('devolución: pedido y motivo', () =>
    expect(
      textoMovimientoSaldo({ ...base, tipo: 'devolucion', pedidoFolio: 5, devolucionMotivo: 'broche roto' }),
    ).toBe('Devolución de KZR-5: broche roto'));
  it('uso: el pedido en que se aplicó', () =>
    expect(textoMovimientoSaldo({ ...base, tipo: 'uso', pedidoFolio: 8 })).toBe('Usado en KZR-8'));
  it('retiro: la nota', () =>
    expect(textoMovimientoSaldo({ ...base, tipo: 'retiro', nota: 'Se entregó en mano' })).toBe(
      'Retiro en efectivo: Se entregó en mano',
    ));
  it('sobrante', () =>
    expect(textoMovimientoSaldo({ ...base, tipo: 'sobrante', pedidoFolio: 2 })).toBe(
      'Sobrante de pago en KZR-2',
    ));
  it('anulación: un pago deshecho (Plan 4b)', () =>
    expect(textoMovimientoSaldo({ ...base, tipo: 'anulacion' })).toBe('Pago deshecho'));
  it('sin folio ni motivo no deja huecos', () => {
    expect(textoMovimientoSaldo({ ...base, tipo: 'devolucion' })).toBe('Devolución');
    expect(textoMovimientoSaldo({ ...base, tipo: 'retiro' })).toBe('Retiro en efectivo');
  });
});

describe('montoConSigno', () => {
  it('entradas con +, salidas con −', () => {
    expect(montoConSigno('100.00')).toBe('+$100.00');
    expect(montoConSigno('-250.50')).toBe('−$250.50');
  });
});
