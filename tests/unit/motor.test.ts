import { describe, expect, it } from 'vitest';
import { crearMotor } from '@/search/motor';
import type { IndiceBusqueda } from '@/search/tipos';

const indice: IndiceBusqueda = {
  v: 1,
  piezas: [
    ['p1', 'AF12', 'Anillo serpiente con circonitas', 'disponible'],
    ['p2', 'AF120', 'Pulsera hilo rosa', 'vendida'],
    ['p3', 'X/1', '<img src=x onerror=alert(1)>', 'disponible'],
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
    const m = crearMotor({ v: 1, piezas: [], clientes: [['a/b?c', 'Zoe', null]], vendedores: [] });
    expect(m.buscar('zoe')[0]!.href).toBe('/panel/clientes/a%2Fb%3Fc');
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
