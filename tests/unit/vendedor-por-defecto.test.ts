import { describe, expect, it } from 'vitest';
import { vendedorPorDefecto } from '@/features/pedidos/vendedor-por-defecto';

const v = (id: string, tipo: 'casa' | 'revendedora' | 'consignacion') => ({ id, tipo });
const lista = [v('r1', 'revendedora'), v('c1', 'casa'), v('c2', 'casa')];

describe('vendedorPorDefecto (D-1)', () => {
  it('usa el habitual del cliente si está entre los activos', () => {
    expect(vendedorPorDefecto(lista, { vendedorHabitualId: 'r1' })).toBe('r1');
  });
  it('si el habitual no está activo o no hay cliente, el primero de tipo casa', () => {
    expect(vendedorPorDefecto(lista, { vendedorHabitualId: 'x' })).toBe('c1');
    expect(vendedorPorDefecto(lista, null)).toBe('c1');
  });
  it('sin casa, el primero; sin vendedores, cadena vacía', () => {
    expect(vendedorPorDefecto([v('r1', 'revendedora')], null)).toBe('r1');
    expect(vendedorPorDefecto([], null)).toBe('');
  });
});
