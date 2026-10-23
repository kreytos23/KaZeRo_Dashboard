import { describe, expect, it } from 'vitest';
import { leerLibros } from '../../../scripts/migrar-excel/leer';
import { planCatalogosYPiezas } from '../../../scripts/migrar-excel/plan-piezas';
import { nuevoContexto } from '../../../scripts/migrar-excel/tipos';
import {
  fecha,
  filaConc,
  filaInv,
  librosSinteticos,
  type DatosSinteticos,
} from '../../apoyo/libro-sintetico';
import { mapeoSintetico } from '../../apoyo/mapeo-sintetico';

async function planear(d: DatosSinteticos, hojas: string[] = [], extra: Record<string, unknown> = {}) {
  const b = await librosSinteticos(d);
  const ctx = nuevoContexto();
  const p = planCatalogosYPiezas(
    await leerLibros({ ...b, hojasExhibidor: hojas }),
    mapeoSintetico(extra),
    ctx,
  );
  return { p, ctx };
}
const porCodigo = (p: Awaited<ReturnType<typeof planear>>['p'], c: string) =>
  p.piezas.find((x) => x.codigo === c)!;

describe('planCatalogosYPiezas', () => {
  it('M-20 un código repetido: la última aparición parecida es la pieza del inventario; la otra es H-', async () => {
    const b = await librosSinteticos({
      inventario: [
        [
          'ZZ14',
          'Anillos',
          'Anillo flor azul',
          'Rodio',
          'PROV UNO',
          50,
          150,
          1,
          'Kazero',
          'Clienta Uno',
          null,
        ],
      ],
      concentrado: [
        [
          fecha(2025, 5, 2),
          40,
          120,
          'Clienta Dos',
          'Vendido',
          null,
          'ZZ14',
          'Pulsera eslabón',
          '05may. vende',
          'N/A',
          'Prov Uno',
          null,
          null,
        ],
        [
          fecha(2026, 8, 1),
          50,
          150,
          'Clienta Uno',
          'Por cobrar',
          null,
          'ZZ14',
          'Anillo flor azul',
          '02sep. aparta',
          'N/A',
          'Prov Uno',
          null,
          null,
        ],
      ],
    });
    const ctx = nuevoContexto();
    const p = planCatalogosYPiezas(await leerLibros({ ...b, hojasExhibidor: [] }), mapeoSintetico(), ctx);
    expect(p.piezas.map((x) => x.codigo).sort()).toEqual(['H-ZZ14', 'ZZ14']);
    expect(p.vinculo.get(4)).toBe(p.piezas.find((x) => x.codigo === 'ZZ14')!.id); // fila 4 = segunda del Concentrado
    expect(p.piezas.find((x) => x.codigo === 'H-ZZ14')).toMatchObject({
      precio: 12000,
      descripcion: 'Pulsera eslabón',
    });
    expect(p.vinculo.get(3)).toBe(p.piezas.find((x) => x.codigo === 'H-ZZ14')!.id);
  });

  it('M-20 la última aparición que no se parece a nada no se une: todas son H- y el inventario queda solo', async () => {
    const { p } = await planear({
      inventario: [filaInv({ id: 'ZZ14', prod: 'Anillo flor azul', precio: 150 })],
      concentrado: [
        filaConc({
          f: fecha(2026, 8, 1),
          venta: 99,
          cliente: 'Otra',
          estatus: 'Vendido',
          id: 'ZZ14',
          desc: 'Collar luna roja',
        }),
        filaConc({
          f: fecha(2026, 8, 2),
          venta: 98,
          cliente: 'Otra',
          estatus: 'Vendido',
          id: 'ZZ14',
          desc: 'Collar luna roja',
        }),
      ],
    });
    expect(p.piezas.map((x) => x.codigo).sort()).toEqual(['H-ZZ14', 'H-ZZ14-2', 'ZZ14']);
    expect(p.vinculo.get(3)).not.toBe(porCodigo(p, 'ZZ14').id);
  });

  it('M-20 el cliente o el precio también bastan para unir; sin código la fila es H-F<fila>', async () => {
    const { p } = await planear({
      inventario: [
        filaInv({ id: 'ZZ01', prod: 'Anillo uno', precio: 150, cliente: 'Clienta Uno' }),
        filaInv({ id: 'ZZ02', prod: 'Pulsera dos', precio: 200 }),
      ],
      concentrado: [
        filaConc({
          f: fecha(2026, 8, 1),
          venta: 90,
          cliente: 'Vend A - Clienta Uno',
          estatus: 'Vendido',
          id: 'ZZ01',
          desc: 'Cosa rara',
        }),
        filaConc({
          f: fecha(2026, 8, 2),
          venta: 200,
          cliente: 'X',
          estatus: 'Vendido',
          id: 'ZZ02',
          desc: 'Otra cosa',
        }),
        filaConc({ f: fecha(2026, 8, 3), venta: 50, cliente: 'X', estatus: 'Vendido', desc: 'Sin código' }),
      ],
    });
    expect(p.vinculo.get(3)).toBe(porCodigo(p, 'ZZ01').id); // mismo cliente (prefijo aparte)
    expect(p.vinculo.get(4)).toBe(porCodigo(p, 'ZZ02').id); // mismo precio
    expect(p.piezas.find((x) => x.id === p.vinculo.get(5))!.codigo).toBe('H-F5');
  });

  it('M-21 la ubicación del inventario se resuelve con el mapeo; sin mapeo se rechaza la pieza', async () => {
    const { p, ctx } = await planear({
      inventario: [
        filaInv({ id: 'ZZ01', ubic: 'Exhibidor A - 16sep' }),
        filaInv({ id: 'ZZ02', ubic: 'Lugar desconocido' }),
        filaInv({ id: 'ZZ03', ubic: 'Defecto' }),
        filaInv({ id: 'ZZ04', ubic: 'Kazero' }),
      ],
    });
    expect(p.piezas.map((x) => x.codigo).sort()).toEqual(['ZZ01', 'ZZ03', 'ZZ04']);
    expect(ctx.rechazos).toEqual([
      expect.objectContaining({ hoja: 'INVENTARIO', fila: 3, motivo: 'ubicación sin exhibidor' }),
    ]);
    expect(p.exhibidores).toHaveLength(1);
    expect(porCodigo(p, 'ZZ01')).toMatchObject({ estado: 'en_exhibidor', exhibidorId: p.exhibidores[0]!.id });
    expect(porCodigo(p, 'ZZ03')).toMatchObject({ estado: 'defecto', exhibidorId: null });
    expect(porCodigo(p, 'ZZ04')).toMatchObject({ estado: 'disponible', exhibidorId: null });
    expect(p.exhibidores[0]).toMatchObject({ nombre: 'Exhibidor A 16sep', fechaEnvio: '2026-09-16' });
  });

  it('M-22 sin precio → guardada, precio 0 y aviso; costo mayor que el precio → aviso pero se importa', async () => {
    const { p, ctx } = await planear({
      inventario: [filaInv({ id: 'ZZ01', precio: null }), filaInv({ id: 'ZZ02', costo: 300, precio: 100 })],
    });
    expect(porCodigo(p, 'ZZ01')).toMatchObject({ estado: 'guardada', precio: 0 });
    expect(porCodigo(p, 'ZZ02')).toMatchObject({ estado: 'disponible', costo: 30000, precio: 10000 });
    expect(ctx.avisos.map((a) => a.tipo).sort()).toEqual(
      expect.arrayContaining(['costo_mayor_que_precio', 'inventario_sin_precio']),
    );
  });

  it('M-23 proveedor numérico → NULL + aviso; categoría histórica por la primera palabra o sin categoría', async () => {
    const { p, ctx } = await planear({
      inventario: [filaInv({ id: 'ZZ01', prov: 12345 }), filaInv({ id: 'ZZ02', prov: 'prov  uno' })],
      concentrado: [
        filaConc({
          f: fecha(2026, 1, 5),
          venta: 100,
          estatus: 'Vendido',
          id: 'AB01',
          desc: 'Pulsera de plata',
          prov: 'Prov Raro',
        }),
        filaConc({ f: fecha(2026, 1, 6), venta: 100, estatus: 'Vendido', id: 'AB02', desc: 'Cosa rara' }),
      ],
    });
    expect(porCodigo(p, 'ZZ01').proveedorId).toBeNull();
    expect(ctx.avisos.some((a) => a.tipo === 'proveedor_descartado')).toBe(true);
    expect(p.proveedores.map((x) => x.nombre)).toEqual(['Proveedor Uno']);
    expect(porCodigo(p, 'ZZ02').proveedorId).toBe(p.proveedores[0]!.id);
    const cat = (c: string) => p.categorias.find((x) => x.id === porCodigo(p, c).categoriaId)!.nombre;
    expect(cat('H-AB01')).toBe('Pulseras');
    expect(cat('H-AB02')).toBe('Sin categoría (histórico)');
    expect(porCodigo(p, 'H-AB01').proveedorId).toBeNull(); // mapeado a null = sin proveedor
    expect(porCodigo(p, 'H-AB01').materialId).toBeNull();
  });

  it('piezas históricas: precio cobrado, alta = fecha de compra (o la de la fila anterior), estado según el estatus', async () => {
    const { p, ctx } = await planear({
      concentrado: [
        filaConc({
          f: fecha(2026, 1, 5),
          costo: 40,
          venta: 100,
          cliente: 'A',
          estatus: 'Vendido',
          id: 'AB01',
          desc: 'Anillo',
        }),
        filaConc({ costo: 'abc', venta: null, cliente: 'A', estatus: 'Por cobrar', id: 'AB02', desc: '' }),
        filaConc({ f: fecha(2026, 1, 8), venta: 10, estatus: 'Rifa', id: 'AB03', desc: 'Collar' }),
        filaConc({ f: fecha(2026, 1, 9), venta: 10, estatus: 'Defecto', id: 'AB04', desc: 'Collar' }),
        filaConc({ f: fecha(2026, 1, 9), venta: 10, estatus: 'Disponible', id: 'AB05', desc: 'Collar' }),
        filaConc({ f: fecha(2026, 1, 9), venta: 10, estatus: 'Cambio', id: 'AB06', desc: 'Collar' }),
        filaConc({ f: fecha(2026, 1, 9), venta: 10, estatus: 'Rarísimo', id: 'AB07', desc: 'Collar' }),
        filaConc({ f: fecha(2026, 1, 9), venta: 10, estatus: null, id: 'AB08', desc: 'Collar' }),
        filaConc({
          f: fecha(2026, 1, 9),
          venta: 10,
          estatus: 'Regalo',
          cliente: 'A',
          id: 'AB09',
          desc: 'Collar',
        }),
        filaConc({ f: fecha(2026, 1, 9), venta: 10, estatus: 'Regalo', id: 'AB10', desc: 'Collar' }),
      ],
    });
    expect(porCodigo(p, 'H-AB01')).toMatchObject({
      precio: 10000,
      costo: 4000,
      fechaAlta: '2026-01-05',
      estado: 'vendida',
    });
    expect(porCodigo(p, 'H-AB02')).toMatchObject({
      precio: 0,
      costo: 0,
      fechaAlta: '2026-01-05',
      descripcion: 'Pieza histórica sin descripción',
      estado: 'apartada',
    });
    expect(porCodigo(p, 'H-AB03').estado).toBe('regalo');
    expect(porCodigo(p, 'H-AB04').estado).toBe('defecto');
    expect(porCodigo(p, 'H-AB05').estado).toBe('guardada'); // solo en el Concentrado (P-6)
    expect(porCodigo(p, 'H-AB09').estado).toBe('vendida'); // regalo con cliente: la Task 4 crea el pedido
    expect(porCodigo(p, 'H-AB10').estado).toBe('regalo');
    expect(p.piezas.find((x) => x.codigo === 'H-AB06')).toBeUndefined();
    expect(ctx.rechazos.map((r) => [r.fila, r.motivo])).toEqual(
      expect.arrayContaining([
        [8, 'estatus ignorado'],
        [9, 'estatus sin clasificar'],
        [10, 'estatus vacío'],
      ]),
    );
    expect(ctx.avisos.map((a) => a.tipo)).toEqual(
      expect.arrayContaining(['precio_vacio', 'costo_invalido', 'descripcion_vacia', 'fecha_alta_inferida']),
    );
  });

  it('M-27 solo se crean exhibidores con piezas; las "Histórico por conciliar" agrupan las que no respalda su hoja', async () => {
    const { p } = await planear(
      {
        inventario: [filaInv({ id: 'ZZ01', ubic: 'Exhibidor A - 16sep' })],
        concentrado: [
          filaConc({ f: fecha(2026, 6, 1), venta: 100, estatus: 'Vend A 06jul', id: 'AB01', desc: 'Anillo' }),
          filaConc({ f: fecha(2026, 6, 1), venta: 100, estatus: 'Vend A 06jul', id: 'AB02', desc: 'Anillo' }),
        ],
        exhibidores: { 'Vend A': [['AB01', 'Anillo', 100, null]] },
      },
      ['Vend A'],
      {
        vendedores: [
          { nombre: 'Casa Prueba', tipo: 'casa', comisionPct: '0', alias: [] },
          { nombre: 'Vendedora A', tipo: 'revendedora', comisionPct: '15', alias: ['Vend A'] },
          { nombre: 'Vendedora B', tipo: 'consignacion', comisionPct: '15', alias: [] },
        ],
      },
    );
    const nombres = p.exhibidores.map((e) => e.nombre).sort();
    expect(nombres).toEqual(['Exhibidor A 16sep', 'Histórico por conciliar', 'Vend A 06jul']);
    const ex = (n: string) => p.exhibidores.find((e) => e.nombre === n)!;
    expect(porCodigo(p, 'H-AB01').exhibidorId).toBe(ex('Vend A 06jul').id); // respaldada por su hoja
    expect(porCodigo(p, 'H-AB02').exhibidorId).toBe(ex('Histórico por conciliar').id);
    expect(ex('Histórico por conciliar')).toMatchObject({ fechaEnvio: '2026-07-06' });
    expect(porCodigo(p, 'H-AB02').estado).toBe('en_exhibidor');
  });

  it('M-27 el exhibidor del mapeo sin piezas no se crea; la hoja solo verifica (aviso)', async () => {
    const { p, ctx } = await planear(
      {
        inventario: [filaInv({ id: 'ZZ01' })],
        exhibidores: {
          VendA: [
            ['ZZ01', 'Anillo', 100, null],
            ['ZZ99', 'Fantasma', 50, null],
            ['??', 'Mal código', 50, null],
          ],
        },
      },
      ['VendA'],
    );
    expect(p.exhibidores).toEqual([]);
    expect(ctx.avisos.filter((a) => a.tipo === 'hoja_exhibidor_no_cuadra').map((a) => a.fila)).toEqual([
      3, 4, 5,
    ]);
  });

  it('dos filas idénticas sin código son dos piezas distintas (claves únicas)', async () => {
    const fila = () => filaConc({ f: fecha(2026, 5, 2), venta: 50, estatus: 'Vendido', desc: 'Pieza igual' });
    const { p } = await planear({ concentrado: [fila(), fila()] });
    expect(p.piezas.map((x) => x.codigo)).toEqual(['H-F3', 'H-F4']);
    expect(new Set(p.piezas.map((x) => x.id)).size).toBe(2);
    expect(p.piezas.map((x) => x.origen.clave.endsWith('#1') || x.origen.clave.endsWith('#2'))).toEqual([
      true,
      true,
    ]);
  });

  it('un código inválido o repetido en el inventario se rechaza', async () => {
    const { p, ctx } = await planear({
      inventario: [filaInv({ id: 'ZZ01' }), filaInv({ id: 'zz01' }), filaInv({ id: 'mal codigo!' })],
    });
    expect(p.piezas).toHaveLength(1);
    expect(ctx.rechazos.map((r) => r.motivo).sort()).toEqual([
      'código de inventario inválido',
      'código de inventario repetido',
    ]);
  });
});
