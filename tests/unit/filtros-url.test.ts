import { describe, expect, it } from 'vitest';
import { hayFiltros, urlSinFiltro, urlSinFiltros } from '@/features/ui/filtros-url';

describe('filtros-url', () => {
  const sp = new URLSearchParams('categoria=a1&material=m2&pagina=3&q=anillo');
  const claves = ['categoria', 'material', 'q'];

  it('hayFiltros ignora la página', () => {
    expect(hayFiltros(sp, claves)).toBe(true);
    expect(hayFiltros(new URLSearchParams('pagina=2'), ['categoria'])).toBe(false);
  });

  it('urlSinFiltros quita las claves y la página', () => {
    expect(urlSinFiltros('/panel/inventario', sp, claves)).toBe('/panel/inventario');
    expect(
      urlSinFiltros('/panel/pedidos', new URLSearchParams('orden=fecha&estado=abierto'), ['estado']),
    ).toBe('/panel/pedidos?orden=fecha');
  });

  it('urlSinFiltro quita una clave y la página', () => {
    expect(urlSinFiltro('/panel/inventario', sp, 'material')).toBe('/panel/inventario?categoria=a1&q=anillo');
  });
});
