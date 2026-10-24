import { describe, expect, it } from 'vitest';
import { crearMotor } from '@/search/motor';
import type { IndiceBusqueda } from '@/search/tipos';

const indice: IndiceBusqueda = {
  v: 4,
  piezas: [
    [
      'p1',
      'AF12',
      'Anillo serpiente con circonitas',
      'disponible',
      '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
      null,
    ],
    ['p2', 'AF120', 'Pulsera hilo rosa', 'vendida', null, null],
    ['p3', 'X/1', '<img src=x onerror=alert(1)>', 'disponible', null, 'Con Nelly'],
  ],
  clientes: [
    ['c1', 'Danya', '5to norte'],
    ['c2', 'Rocío Santibañez', null],
    ['c3', 'Thelina', null],
  ],
  vendedores: [
    ['v1', 'Nelly'],
    ['v2', 'Ana'],
  ],
  pedidos: [['p1', 34, 'Gloria Roldán', 'abierto']],
};
const motor = crearMotor(indice);
const claves = (q: string, recientes?: string[]) => motor.buscar(q, recientes).map((r) => r.clave);

describe('búsqueda global (diseño §8)', () => {
  it('un código exacto va primero aunque otro empiece igual', () => {
    expect(claves('af12')[0]).toBe('pieza:p1');
    expect(motor.buscar('af12')[0]).toMatchObject({
      href: '/panel/inventario/AF12',
      subtitulo: 'Disponible',
    });
  });
  it('el código exacto gana incluso con espacios y minúsculas', () => {
    expect(claves('  af 12 ')[0]).toBe('pieza:p1');
  });
  it('palabras con prefijo en cualquier orden: "dan 5to"', () => {
    expect(claves('dan 5to')).toEqual(['cliente:c1']);
  });
  it('sin acentos ni mayúsculas, en la consulta y en el índice', () => {
    expect(claves('santibanez')).toEqual(['cliente:c2']);
    expect(claves('ROCÍO')).toEqual(['cliente:c2']);
  });
  it('tolera un error en palabras de 4+ letras', () => {
    expect(claves('thelyna')).toEqual(['cliente:c3']);
  });
  it('no aplica tolerancia a palabras cortas (evita ruido)', () => {
    expect(claves('nwl')).toEqual([]);
    expect(claves('anb')).toEqual([]);
  });
  it('busca en descripción y vendedores', () => {
    expect(claves('serpiente')).toEqual(['pieza:p1']);
    expect(motor.buscar('nelly')[0]).toMatchObject({ tipo: 'vendedor', href: '/panel/vendedores/v1' });
  });
  it('los recientes suben en el empate', () => {
    expect(claves('af', ['pieza:p2'])[0]).toBe('pieza:p2');
  });
  it('consulta vacía o en blanco no devuelve nada', () => {
    expect(claves('   ')).toEqual([]);
    expect(claves('')).toEqual([]);
  });
  it('el límite se acota a un rango razonable', () => {
    expect(motor.buscar('a', [], 1)).toHaveLength(1);
    expect(motor.buscar('a', [], 0).length).toBeGreaterThanOrEqual(1);
    expect(motor.buscar('a', [], -5).length).toBeGreaterThanOrEqual(1);
    expect(motor.buscar('a', [], Number.NaN).length).toBeGreaterThanOrEqual(1);
    expect(motor.buscar('a', [], 1e9).length).toBeLessThanOrEqual(50);
  });
  it('los href codifican el código y el texto peligroso queda como texto', () => {
    const r = motor.buscar('X/1')[0]!;
    expect(r.clave).toBe('pieza:p3');
    expect(r.href).toBe('/panel/inventario/X%2F1');
    expect(r.titulo).toContain('<img');
  });
  it('los href de cliente y vendedor codifican el id', () => {
    const m = crearMotor({
      v: 4,
      piezas: [],
      clientes: [['a/b?c', 'Zoe', null]],
      vendedores: [],
      pedidos: [],
    });
    expect(m.buscar('zoe')[0]!.href).toBe('/panel/clientes/a%2Fb%3Fc');
  });
});

describe('ubicación (índice v4)', () => {
  it('el subtítulo suma la ubicación solo cuando viene (exhibidor o vendedora)', () => {
    expect(motor.buscar('AF12')[0]!.subtitulo).toBe('Disponible');
    expect(motor.buscar('X/1')[0]!.subtitulo).toBe('Disponible · Con Nelly');
  });
});

describe('miniaturas (índice v2)', () => {
  it('las piezas con foto traen su miniatura; las demás y personas, null', () => {
    const [af12] = motor.buscar('AF12');
    expect(af12!.miniatura).toBe('/api/piezas/p1/imagen?v=9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d&t=mini');
    expect(motor.buscar('pulsera hilo')[0]!.miniatura).toBeNull();
    expect(motor.buscar('danya')[0]!.miniatura).toBeNull();
  });
});

describe('consulta vacía con recientes', () => {
  it('devuelve los recientes que existen, en orden, e ignora los desconocidos', () => {
    expect(claves('', ['cliente:c3', 'pieza:zzz', 'pieza:p1'])).toEqual(['cliente:c3', 'pieza:p1']);
  });
});

describe('código escrito con guion o espacios', () => {
  it('"af-12" y "af 12" encuentran AF12 primero', () => {
    expect(claves('af-12')[0]).toBe('pieza:p1');
    expect(claves('af 12')[0]).toBe('pieza:p1');
  });
});

const motorConPieza34 = crearMotor({
  ...indice,
  piezas: [...indice.piezas, ['p34', '34', 'Dije', 'disponible', null, null]],
});
describe('folios de pedido', () => {
  it('D-16: "KZR-34", "kzr34" y "kzr 34" abren el pedido 34', () => {
    for (const q of ['KZR-34', 'kzr34', 'kzr 34'])
      expect(motor.buscar(q)[0]).toMatchObject({
        tipo: 'pedido',
        href: '/panel/pedidos/34',
        titulo: 'KZR-34 · Gloria Roldán',
      });
  });
  it('D-16: "34" abre la pieza 34 si existe; si no, el pedido 34', () => {
    expect(motorConPieza34.buscar('34')[0]).toMatchObject({ tipo: 'pieza' });
    expect(motor.buscar('34')[0]).toMatchObject({ tipo: 'pedido' });
  });
  it('opción tipos: solo clientes (selector de cliente del pedido)', () => {
    expect(motor.buscar('gloria', [], 8, { tipos: ['cliente'] }).every((r) => r.tipo === 'cliente')).toBe(
      true,
    );
    expect(motor.buscar('kzr-34', [], 8, { tipos: ['cliente'] })).toEqual([]);
  });
  it('el estado del pedido se muestra con etiqueta', () => {
    expect(motor.buscar('kzr-34')[0]!.subtitulo).toBe('Abierto');
  });
});
