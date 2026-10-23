import { describe, expect, it } from 'vitest';
import {
  destinosManuales,
  ETIQUETA_ESTADO,
  ETIQUETA_MOVIMIENTO,
  textoBotonFoto,
  textoMovimiento,
} from '@/app/panel/inventario/etiquetas';
import { tipoMovimiento } from '@/db/schema';
import { POR_PAGINA, idDeCatalogo, leerFiltros } from '@/app/panel/inventario/filtros';

describe('textoBotonFoto', () => {
  it('el botón de la foto dice Subir o Cambiar según haya foto', () => {
    expect(textoBotonFoto(false)).toBe('Subir foto');
    expect(textoBotonFoto(true)).toBe('Cambiar foto');
  });
});

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

describe('ETIQUETA_MOVIMIENTO', () => {
  it('todo tipo de movimiento tiene etiqueta, incluida la corrección', () => {
    expect(Object.keys(ETIQUETA_MOVIMIENTO).sort()).toEqual([...tipoMovimiento.enumValues].sort());
  });
});

describe('leerFiltros', () => {
  it('valores por defecto', () => {
    expect(leerFiltros({})).toEqual({
      q: '',
      estado: undefined,
      categoria: undefined,
      material: undefined,
      proveedor: undefined,
      pagina: 1,
    });
  });
  it('descarta valores inválidos en vez de fallar', () => {
    const f = leerFiltros({ estado: 'inventado', categoria: '   ', pagina: '-3' });
    expect(f.estado).toBeUndefined();
    expect(f.categoria).toBeUndefined();
    expect(f.pagina).toBe(1);
  });
  it('acepta válidos, toma el primero de un arreglo y acota la página y q', () => {
    const f = leerFiltros({
      estado: ['vendida', 'defecto'],
      categoria: ['Anillos', 'Aretes'],
      material: ' Oro  ',
      proveedor: 'p'.repeat(200),
      pagina: '2',
      q: 'x'.repeat(500),
    });
    expect(f.estado).toBe('vendida');
    expect(f.categoria).toBe('Anillos');
    expect(f.material).toBe('Oro');
    expect(f.proveedor).toHaveLength(80);
    expect(f.pagina).toBe(2);
    expect(f.q).toHaveLength(120);
    expect(leerFiltros({ pagina: '99999999' }).pagina).toBe(1000);
    expect(leerFiltros({ pagina: '1.5' }).pagina).toBe(1);
  });
  it('expone el tamaño de página', () => {
    expect(POR_PAGINA).toBe(50);
  });
});

describe('idDeCatalogo', () => {
  const cat = [
    { id: 'a', nombre: 'Anillos' },
    { id: 'b', nombre: 'Acero inoxidable' },
  ];
  it('sin nombre no filtra', () => {
    expect(idDeCatalogo(cat, undefined)).toBeUndefined();
  });
  it('resuelve sin acentos ni mayúsculas', () => {
    expect(idDeCatalogo(cat, 'ANILLOS')).toBe('a');
    expect(idDeCatalogo(cat, 'acero  inoxidable')).toBe('b');
  });
  it('un nombre desconocido da un id inexistente (cero resultados, no "todos")', () => {
    expect(idDeCatalogo(cat, 'Relojes')).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('ubicación en el inventario (Plan 3.1)', () => {
  it('filtra por ubicación y vendedora; lo inválido se descarta', () => {
    const v = '0b0e4c43-4a6b-4a1f-9a5e-2f9d8d1e7c11';
    expect(leerFiltros({ ubicacion: 'vendedora', vendedor: v })).toMatchObject({
      ubicacion: 'vendedora',
      vendedor: v,
    });
    expect(leerFiltros({ ubicacion: 'kazero' }).ubicacion).toBe('kazero');
    expect(leerFiltros({ ubicacion: 'fuera' }).ubicacion).toBeUndefined();
    expect(leerFiltros({ ubicacion: 'inventada', vendedor: 'no-uuid' })).toMatchObject({
      ubicacion: undefined,
      vendedor: undefined,
    });
  });
  it('la vendedora solo cuenta con la ubicación «Con vendedora»', () => {
    const v = '0b0e4c43-4a6b-4a1f-9a5e-2f9d8d1e7c11';
    expect(leerFiltros({ ubicacion: 'kazero', vendedor: v }).vendedor).toBeUndefined();
  });
  it('los movimientos de custodia nombran a la vendedora y la devolución a su pedido', () => {
    const m = { vendedorNombre: 'Nelly', pedidoFolio: 5 };
    expect(textoMovimiento({ ...m, tipo: 'entrega_vendedora' })).toBe('Entregada a Nelly');
    expect(textoMovimiento({ ...m, tipo: 'regreso_vendedora' })).toBe('Regresó a Kazero de Nelly');
    expect(textoMovimiento({ ...m, tipo: 'devolucion' })).toBe('Devuelta por defecto (KZR-5)');
    expect(textoMovimiento({ ...m, tipo: 'alta' })).toBe('Alta');
    expect(textoMovimiento({ vendedorNombre: null, pedidoFolio: null, tipo: 'entrega_vendedora' })).toBe(
      'Entregada a vendedora',
    );
  });
});
