import { describe, expect, it } from 'vitest';
import { montoDevolucion, repartirDescuentoManual } from '@/domain/devolucion';

describe('repartirDescuentoManual (D-15)', () => {
  it('la suma de las partes es exactamente el descuento (residuo mayor)', () => {
    const partes = repartirDescuentoManual([10000, 10000, 10000], 10000);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(partes).toEqual([3334, 3333, 3333]);
  });
  it('sin descuento, todo en 0', () => expect(repartirDescuentoManual([14900, 9900], 0)).toEqual([0, 0]));
  it('proporcional al precio', () =>
    expect(repartirDescuentoManual([30000, 10000], 4000)).toEqual([3000, 1000]));
  it('rechaza descuento mayor que la suma o entradas no enteras', () => {
    expect(() => repartirDescuentoManual([100], 101)).toThrow();
    expect(() => repartirDescuentoManual([100.5], 0)).toThrow();
  });
  it('nunca reparte más que el precio de una línea (no se devuelve más de lo cobrado)', () => {
    const precios = [1, 1, 1, 99997];
    const partes = repartirDescuentoManual(precios, 100000);
    expect(partes.every((p, i) => p <= precios[i]!)).toBe(true);
  });
});

describe('montoDevolucion', () => {
  const lineas = [
    { id: 'a', precioFinal: 30000 },
    { id: 'b', precioFinal: 10000 },
  ];
  it('sin descuento manual = precio_final', () => expect(montoDevolucion(lineas, 0, 'b')).toBe(10000));
  it('con descuento manual = precio_final − su parte', () =>
    expect(montoDevolucion(lineas, 4000, 'a')).toBe(27000));
  it('Σ devoluciones de todas las líneas = total del pedido', () => {
    const total = 40000 - 4000;
    expect(montoDevolucion(lineas, 4000, 'a') + montoDevolucion(lineas, 4000, 'b')).toBe(total);
  });
  it('línea inexistente → error', () => expect(() => montoDevolucion(lineas, 0, 'z')).toThrow());
});
