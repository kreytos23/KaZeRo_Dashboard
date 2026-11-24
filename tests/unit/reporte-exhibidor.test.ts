import { describe, expect, it } from 'vitest';
import { mesAnterior, mesesRecientes } from '@/domain/comisiones';
import {
  hojaSale,
  incluirVentas,
  notasVendidas,
  piezasAlCierre,
  type MovExhibidor,
} from '@/domain/reporte-exhibidor';

let orden = 0;
const mov = (
  piezaId: string,
  tipo: string,
  deEstado: string | null,
  aEstado: string,
  dia: string,
  pedidoId: string | null = null,
): MovExhibidor => ({ piezaId, tipo, deEstado, aEstado, dia, pedidoId, orden: ++orden });

const OCT = '2026-10-01';
const NOV = '2026-11-01';

describe('meses', () => {
  it('mesAnterior cruza el año', () => {
    expect(mesAnterior('2026-01-01')).toBe('2025-12-01');
    expect(mesAnterior('2026-11-01')).toBe('2026-10-01');
  });
  it('mesesRecientes empieza en el mes de hoy y va hacia atrás', () => {
    expect(mesesRecientes('2026-02-15', 3)).toEqual(['2026-02-01', '2026-01-01', '2025-12-01']);
  });
});

describe('piezas al cierre', () => {
  it('solo las que siguen en el exhibidor al terminar el mes', () => {
    const movs = [
      mov('a', 'envio_exhibidor', 'disponible', 'en_exhibidor', '2026-10-02'),
      mov('b', 'envio_exhibidor', 'disponible', 'en_exhibidor', '2026-10-02'),
      mov('b', 'regreso', 'en_exhibidor', 'disponible', '2026-10-03'),
      mov('a', 'regreso', 'en_exhibidor', 'disponible', '2026-11-03'),
    ];
    expect(piezasAlCierre(movs, OCT)).toEqual(['a']);
    expect(piezasAlCierre(movs, NOV)).toEqual([]);
  });
});

describe('notas vendidas', () => {
  it('cuenta las piezas que salieron del exhibidor en el mes, por nota', () => {
    const movs = [
      mov('a', 'apartado', 'en_exhibidor', 'apartada', '2026-10-05', 'p1'),
      mov('b', 'apartado', 'en_exhibidor', 'apartada', '2026-10-05', 'p1'),
      mov('c', 'apartado', 'en_exhibidor', 'apartada', '2026-11-05', 'p2'),
      mov('d', 'apartado', 'apartada', 'apartada', '2026-10-05', 'p3'),
    ];
    expect([...notasVendidas(movs, OCT)]).toEqual([['p1', 2]]);
  });
  it('una nota cancelada después sigue contando como venta del mes', () => {
    const movs = [
      mov('a', 'apartado', 'en_exhibidor', 'apartada', '2026-10-05', 'p1'),
      mov('a', 'liberacion', 'apartada', 'en_exhibidor', '2026-10-09', 'p1'),
    ];
    expect([...notasVendidas(movs, OCT)]).toEqual([['p1', 1]]);
  });
});

describe('qué hojas salen', () => {
  it('con piezas al cierre sale aunque no haya vendido ni se pidan las ventas', () => {
    expect(hojaSale({ piezasAlCierre: 2, notasDelMes: 0, ventas: false })).toBe(true);
  });
  it('sin piezas, sale solo si se pidieron las ventas y vendió en el mes', () => {
    expect(hojaSale({ piezasAlCierre: 0, notasDelMes: 1, ventas: true })).toBe(true);
    expect(hojaSale({ piezasAlCierre: 0, notasDelMes: 1, ventas: false })).toBe(false);
    expect(hojaSale({ piezasAlCierre: 0, notasDelMes: 0, ventas: true })).toBe(false);
  });
});

describe('casilla «Incluir ventas del mes»', () => {
  it('solo «1» la enciende; cualquier otro valor (o ninguno) cuenta como apagada', () => {
    expect(incluirVentas('1')).toBe(true);
    for (const v of [null, undefined, '', '0', 'si', 'true', '1 ', ['1']])
      expect(incluirVentas(v)).toBe(false);
  });
});
