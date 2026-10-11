import { describe, expect, it } from 'vitest';
import { destinosManuales, ETIQUETA_ESTADO } from '@/app/panel/inventario/etiquetas';
import { POR_PAGINA, leerFiltros } from '@/app/panel/inventario/filtros';

describe('destinosManuales', () => {
  it('coincide con las transiciones manuales del servicio', () => {
    expect(destinosManuales('disponible')).toEqual(['regalo', 'defecto', 'guardada']);
    expect(destinosManuales('en_exhibidor')).toEqual(['regalo', 'defecto', 'guardada']);
    expect(destinosManuales('defecto')).toEqual(['disponible']);
    expect(destinosManuales('guardada')).toEqual(['disponible']);
  });
  it('no ofrece nada para estados que mueven pedidos o exhibidores', () => {
    for (const e of ['apartada', 'vendida', 'regalo'] as const) expect(destinosManuales(e)).toEqual([]);
  });
  it('todo estado tiene etiqueta', () => {
    expect(Object.keys(ETIQUETA_ESTADO)).toHaveLength(7);
  });
});

describe('leerFiltros', () => {
  const uuid = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';
  it('valores por defecto', () => {
    expect(leerFiltros({})).toEqual({ q: '', estado: undefined, categoria: undefined, pagina: 1 });
  });
  it('descarta valores inválidos en vez de fallar', () => {
    const f = leerFiltros({ estado: 'inventado', categoria: 'no-uuid', pagina: '-3' });
    expect(f.estado).toBeUndefined();
    expect(f.categoria).toBeUndefined();
    expect(f.pagina).toBe(1);
  });
  it('acepta válidos, toma el primero de un arreglo y acota la página y q', () => {
    const f = leerFiltros({
      estado: ['vendida', 'defecto'],
      categoria: uuid,
      pagina: '2',
      q: 'x'.repeat(500),
    });
    expect(f.estado).toBe('vendida');
    expect(f.categoria).toBe(uuid);
    expect(f.pagina).toBe(2);
    expect(f.q).toHaveLength(120);
    expect(leerFiltros({ pagina: '99999999' }).pagina).toBe(1000);
    expect(leerFiltros({ pagina: '1.5' }).pagina).toBe(1);
  });
  it('expone el tamaño de página', () => {
    expect(POR_PAGINA).toBe(50);
  });
});
