import { describe, expect, it } from 'vitest';
import { numericConSigno } from '@/domain/dinero';
import { montoAjusteCentavos, montoMovimiento, rotuloMovimiento } from '@/features/exhibidores/dinero-ui';

describe('numericConSigno', () => {
  it('lee numeric con o sin signo', () => {
    expect(numericConSigno('12.50')).toBe(1250);
    expect(numericConSigno('-12.50')).toBe(-1250);
    expect(numericConSigno('0.00')).toBe(0);
  });
  it('rechaza lo que no es numeric', () => {
    expect(() => numericConSigno('abc')).toThrow(RangeError);
    expect(() => numericConSigno('--1')).toThrow(RangeError);
  });
});

describe('montoMovimiento', () => {
  it('cobro suma, entrega resta y el ajuste conserva su signo', () => {
    expect(montoMovimiento('cobro', 15000)).toBe('+$150.00');
    expect(montoMovimiento('entrega', 5000)).toBe('−$50.00');
    expect(montoMovimiento('ajuste', 2500)).toBe('+$25.00');
    expect(montoMovimiento('ajuste', -2500)).toBe('−$25.00');
  });
});

describe('rotuloMovimiento', () => {
  it('cobro con folio y clienta', () => {
    expect(
      rotuloMovimiento({ tipo: 'cobro', folio: 12, clienteNombre: 'Ana', metodo: 'efectivo', nota: null }),
    ).toBe('Cobro de KZR-12 · Ana');
  });
  it('cobro de mostrador no repite la clienta genérica', () => {
    expect(
      rotuloMovimiento({
        tipo: 'cobro',
        folio: 7,
        clienteNombre: 'Venta de mostrador',
        metodo: 'efectivo',
        nota: null,
      }),
    ).toBe('Cobro de KZR-7 · Venta de mostrador');
  });
  it('entrega con método y ajuste con motivo', () => {
    expect(
      rotuloMovimiento({
        tipo: 'entrega',
        folio: null,
        clienteNombre: null,
        metodo: 'transferencia',
        nota: null,
      }),
    ).toBe('Entrega (transferencia)');
    expect(
      rotuloMovimiento({
        tipo: 'ajuste',
        folio: null,
        clienteNombre: null,
        metodo: null,
        nota: 'Faltó un billete',
      }),
    ).toBe('Ajuste: Faltó un billete');
  });
});

describe('montoAjusteCentavos', () => {
  it('suma o resta según la dirección', () => {
    expect(montoAjusteCentavos('suma', '20')).toBe(2000);
    expect(montoAjusteCentavos('resta', '20.50')).toBe(-2050);
  });
  it('rechaza dirección o monto inválidos', () => {
    expect(montoAjusteCentavos('otra', '20')).toBeNull();
    expect(montoAjusteCentavos('suma', 'x')).toBeNull();
    expect(montoAjusteCentavos('suma', '-5')).toBeNull();
  });
});
