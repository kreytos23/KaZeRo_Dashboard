import { describe, expect, it } from 'vitest';
import type { FilaTarjeta } from '../../../scripts/importar-tarjetas/leer';
import {
  planificarTarjetas,
  renderizarPlan,
  type ClienteBd,
} from '../../../scripts/importar-tarjetas/planificar';

const vendedoras = [
  { id: 'v-perla', nombre: 'Perla Ejemplo', activo: true },
  { id: 'v-casa', nombre: 'Kazero', activo: true },
  { id: 'v-vieja', nombre: 'Rosa Inactiva', activo: false },
];
let n = 3;
const fila = (
  nombre: string,
  apellido: string,
  compras: FilaTarjeta['compras'],
  vendedor = 'Perla',
): FilaTarjeta => ({ fila: ++n, nombre, apellido, compras, vendedor });
const plan = (filas: FilaTarjeta[], clientes: ClienteBd[] = []) =>
  planificarTarjetas(filas, { clientes, vendedoras });

describe('planificar la importación de tarjetas', () => {
  it('crea las nuevas con sus compras y su vendedora (por primer nombre)', () => {
    const p = plan([fila('Ana', 'Uno', 4), fila('Bea', 'Dos', 1, 'kazero')]);
    expect(p.crear).toEqual([
      { nombre: 'Ana Uno', comprasPrevias: 4, vendedorId: 'v-perla' },
      { nombre: 'Bea Dos', comprasPrevias: 1, vendedorId: 'v-casa' },
    ]);
    expect(p.errores).toEqual([]);
    expect(p.vendedoras.map((v) => [v.excel, v.vendedorId, v.clientas])).toEqual([
      ['kazero', 'v-casa', 1],
      ['Perla', 'v-perla', 1],
    ]);
  });

  it('actualiza la existente (sin acentos ni mayúsculas) y cuenta las que ya están igual', () => {
    const clientes: ClienteBd[] = [
      { id: 'c1', nombre: 'Ána  UNO', comprasPrevias: 0, vendedorHabitualId: null, conNotasCiclo1: false },
      {
        id: 'c2',
        nombre: 'Bea Dos',
        comprasPrevias: 1,
        vendedorHabitualId: 'v-perla',
        conNotasCiclo1: false,
      },
    ];
    const p = plan([fila('Ana', 'Uno', 4), fila('Bea', 'Dos', 1)], clientes);
    expect(p.actualizar).toEqual([{ clienteId: 'c1', comprasPrevias: 4, vendedorId: 'v-perla' }]);
    expect(p.sinCambios).toBe(1);
    expect(p.crear).toEqual([]);
  });

  it.each([
    [fila('Ana', 'Uno', 10), /fila \d+: «# de compra» debe ser un entero de 0 a 9/],
    [fila('Ana', 'Uno', 'cuatro'), /entero de 0 a 9/],
    [fila('Ana', 'Uno', 2.5), /entero de 0 a 9/],
    [fila('', '', 2), /falta el nombre/],
    [fila('Ana', 'Uno', 2, 'Nadie'), /vendedora «Nadie» no existe/],
    [fila('Ana', 'Uno', 2, 'Rosa'), /vendedora «Rosa» no existe/],
  ])('error por fila: %j', (f, error) => {
    expect(plan([f]).errores).toEqual([expect.stringMatching(error)]);
  });

  it('nombres repetidos en el Excel o en la BD son error', () => {
    expect(plan([fila('Ana', 'Uno', 1), fila('ana', 'uno', 2)]).errores).toEqual([
      expect.stringMatching(/repetido/),
    ]);
    const dobles: ClienteBd[] = ['c1', 'c2'].map((id) => ({
      id,
      nombre: 'Ana Uno',
      comprasPrevias: 0,
      vendedorHabitualId: null,
      conNotasCiclo1: false,
    }));
    expect(plan([fila('Ana', 'Uno', 1)], dobles).errores).toEqual([
      expect.stringMatching(/más de una clienta/),
    ]);
  });

  it('L-5: una existente con notas en su primera tarjeta es error', () => {
    const c: ClienteBd[] = [
      { id: 'c1', nombre: 'Ana Uno', comprasPrevias: 0, vendedorHabitualId: null, conNotasCiclo1: true },
    ];
    expect(plan([fila('Ana', 'Uno', 3)], c).errores).toEqual([expect.stringMatching(/ya tiene notas/)]);
  });

  it('vendedora ambigua por primer nombre es error', () => {
    const p = planificarTarjetas([fila('Ana', 'Uno', 1, 'Perla')], {
      clientes: [],
      vendedoras: [...vendedoras, { id: 'v-perla2', nombre: 'Perla Otra', activo: true }],
    });
    expect(p.errores).toEqual([expect.stringMatching(/más de una vendedora/)]);
  });

  it('el hash cambia si cambia el plan y no depende del orden de las filas', () => {
    const a = plan([fila('Ana', 'Uno', 4), fila('Bea', 'Dos', 1)]).hash;
    expect(plan([fila('Bea', 'Dos', 1), fila('Ana', 'Uno', 4)]).hash).toBe(a);
    expect(plan([fila('Ana', 'Uno', 5), fila('Bea', 'Dos', 1)]).hash).not.toBe(a);
  });

  it('el reporte no lleva nombres de clientas', () => {
    const texto = renderizarPlan(plan([fila('Ana', 'Uno', 4), fila('Bea', 'Dos', 10)])).join('\n');
    expect(texto).not.toMatch(/Ana|Bea|Uno|Dos/);
    expect(texto).toMatch(/Crear: 1/);
  });
});
