import { describe, expect, it } from 'vitest';
import {
  avisoSinCaptura,
  montosDeReparto,
  parecidosDe,
  resumenReparto,
  textoParecido,
} from '@/features/pagos/formato';

const pedidos = [
  { id: 'a', fecha: '2026-02-01', folio: 1, saldoCentavos: 10000 },
  { id: 'b', fecha: '2026-02-02', folio: 2, saldoCentavos: 5000 },
];

describe('montosDeReparto', () => {
  it('convierte el reparto sugerido en textos de pesos y deja vacío al pedido sin asignar', () => {
    expect(montosDeReparto(12000, pedidos)).toEqual({ a: '100.00', b: '20.00' });
    expect(montosDeReparto(8000, pedidos)).toEqual({ a: '80.00', b: '' });
  });
  it('un monto vacío o inválido no reparte nada', () => {
    expect(montosDeReparto(0, pedidos)).toEqual({ a: '', b: '' });
  });
});

describe('resumenReparto', () => {
  it('suma lo aplicado y calcula el sobrante en vivo', () => {
    const r = resumenReparto(20000, { a: '100', b: '50' }, pedidos);
    expect(r).toMatchObject({ aplicadoCentavos: 15000, sobranteCentavos: 5000, excedeCentavos: 0 });
    expect(r.errores).toEqual({});
  });
  it('marca el pedido que recibe más que su saldo', () => {
    const r = resumenReparto(20000, { a: '150', b: '' }, pedidos);
    expect(r.errores.a).toContain('$100.00');
  });
  it('marca un texto que no es monto y un cero', () => {
    const r = resumenReparto(20000, { a: 'abc', b: '0' }, pedidos);
    expect(r.errores.a).toMatch(/monto válido/);
    expect(r.errores.b).toMatch(/vacío/);
  });
  it('avisa cuánto se pasa lo repartido del pago', () => {
    const r = resumenReparto(10000, { a: '100', b: '50' }, pedidos);
    expect(r.excedeCentavos).toBe(5000);
    expect(r.sobranteCentavos).toBe(0);
  });
  it('pago vacío: todo cero', () => {
    expect(resumenReparto(0, {}, pedidos)).toMatchObject({ aplicadoCentavos: 0, sobranteCentavos: 0 });
  });
});

describe('parecidosDe / textoParecido', () => {
  it('lee la lista que trae el error posible_duplicado y descarta lo que no tiene su forma', () => {
    const lista = [{ pagoId: 'p1', folio: 7, fecha: '2026-02-03', montoCentavos: 15000 }];
    expect(parecidosDe(lista)).toEqual(lista);
    expect(parecidosDe(undefined)).toEqual([]);
    expect(parecidosDe([{ nope: 1 }])).toEqual([]);
  });
  it('describe un pago parecido con pedido o sin él', () => {
    expect(textoParecido({ pagoId: 'p', folio: 7, fecha: '2026-02-03', montoCentavos: 15000 })).toBe(
      '$150.00 del 03/02/2026 (KZR-7)',
    );
    expect(textoParecido({ pagoId: 'p', folio: null, fecha: '2026-02-03', montoCentavos: 15000 })).toBe(
      '$150.00 del 03/02/2026',
    );
  });
});

describe('avisoSinCaptura', () => {
  it('solo una transferencia sin captura recibe el aviso suave', () => {
    expect(avisoSinCaptura('transferencia', false)).toMatch(/captura/i);
    expect(avisoSinCaptura('transferencia', true)).toBeNull();
    expect(avisoSinCaptura('efectivo', false)).toBeNull();
  });
});
