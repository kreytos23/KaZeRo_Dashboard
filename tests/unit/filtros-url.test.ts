import { describe, expect, it } from 'vitest';
import { filtrosActivos, urlSin } from '@/features/ui/filtros-url';

describe('filtros-url', () => {
  const sp = new URLSearchParams('categoria=a1&material=m2&pagina=3&q=anillo');

  it('urlSin quita las claves y la página', () => {
    expect(urlSin('/panel/inventario', sp, ['categoria', 'material', 'q'])).toBe('/panel/inventario');
    expect(urlSin('/panel/pedidos', new URLSearchParams('orden=fecha&estado=abierto'), ['estado'])).toBe(
      '/panel/pedidos?orden=fecha',
    );
    expect(urlSin('/panel/inventario', sp, ['material'])).toBe('/panel/inventario?categoria=a1&q=anillo');
  });

  it('filtrosActivos: chips con su URL sin ese filtro y URL que los quita todos', () => {
    const { activos, hrefLimpiar } = filtrosActivos('/panel/inventario', [
      { clave: 'q', valor: 'anillo', etiqueta: '“anillo”' },
      { clave: 'estado' },
      { clave: 'material', valor: 'plata', etiqueta: 'plata' },
    ]);
    expect(activos).toEqual([
      { clave: 'q', etiqueta: '“anillo”', href: '/panel/inventario?material=plata' },
      { clave: 'material', etiqueta: 'plata', href: '/panel/inventario?q=anillo' },
    ]);
    expect(hrefLimpiar).toBe('/panel/inventario');
  });

  it('un filtro con valor pero sin etiqueta se conserva en las URL de los demás chips', () => {
    const { activos } = filtrosActivos('/r', [
      { clave: 'ubicacion', valor: 'casa' },
      { clave: 'q', valor: 'x', etiqueta: 'x' },
    ]);
    expect(activos).toEqual([{ clave: 'q', etiqueta: 'x', href: '/r?ubicacion=casa' }]);
  });
});
