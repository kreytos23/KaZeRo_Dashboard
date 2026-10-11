import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { exhibidor, pieza } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { crearVendedor } from '@/server/vendedores/servicio';
import { parsearLote } from '@/domain/lote';
import {
  altaLote,
  altaPieza,
  cambiarEstado,
  historial,
  listarPiezas,
  obtenerPiezaPorCodigo,
  sugerirCodigo,
} from '@/server/piezas/servicio';
import { truncarTodo, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const base = {
  categoria: 'Anillos',
  material: 'Oro laminado',
  proveedor: 'ZABBEL',
  descripcion: 'Anillo serpiente con circonitas',
  costoCentavos: 6500,
  precioCentavos: 14900,
};

beforeEach(truncarTodo);

describe('alta de piezas (R-01, R-02)', () => {
  it('normaliza el código, crea catálogos y registra el movimiento de alta', async () => {
    const r = await app((db) => altaPieza(db, { ...base, codigo: ' ai29 ', fechaAlta: '2026-10-09' }));
    expect(r.codigo).toBe('AI29');
    const f = await app((db) => obtenerPiezaPorCodigo(db, 'ai29'));
    expect(f).toMatchObject({
      codigo: 'AI29',
      categoriaNombre: 'Anillos',
      materialNombre: 'Oro laminado',
      precio: '149.00',
      costo: '65.00',
      estado: 'disponible',
      fechaAlta: '2026-10-09',
    });
    expect((await app((db) => historial(db, f!.id))).map((m) => [m.tipo, m.aEstado])).toEqual([
      ['alta', 'disponible'],
    ]);
  });
  it('rechaza códigos repetidos con mensaje de negocio', async () => {
    await app((db) => altaPieza(db, { ...base, codigo: 'AA01' }));
    await expect(app((db) => altaPieza(db, { ...base, codigo: 'aa01' }))).rejects.toThrow(
      'Ya existe una pieza con ese código.',
    );
  });
  it('sugiere el siguiente consecutivo del prefijo', async () => {
    await app((db) => altaPieza(db, { ...base, codigo: 'AI28' }));
    await app((db) => altaPieza(db, { ...base, codigo: 'AI29' }));
    await app((db) => altaPieza(db, { ...base, codigo: 'AIX01' }));
    expect(await app((db) => sugerirCodigo(db, 'ai'))).toBe('AI30');
    await expect(app((db) => sugerirCodigo(db, 'A1'))).rejects.toThrow(
      'El prefijo debe tener de 1 a 6 letras.',
    );
  });
});

describe('alta por lote', () => {
  it('todo o nada: un código existente aborta el lote e indica la línea', async () => {
    await app((db) => altaPieza(db, { ...base, codigo: 'AB02' }));
    const { filas } = parsearLote(
      ['AB01', 'AB02', 'AB03'].map((c) => [c, 'Aretes', 'Arete', '', '', '30', '89'].join('\t')).join('\n'),
    );
    await expect(app((db) => altaLote(db, filas))).rejects.toThrow(
      'Línea 2: ya existe una pieza con el código AB02.',
    );
    expect(await app((db) => obtenerPiezaPorCodigo(db, 'AB01'))).toBeNull();
  });
  it('resuelve categoría, material y proveedor aunque varíen mayúsculas y espacios', async () => {
    const fila = (c: string, cat: string, mat: string, prov: string) =>
      [c, cat, 'Pieza', mat, prov, '10', '20'].join('\t');
    const { filas, errores } = parsearLote(
      [
        fila('AF01', 'Anillos', 'Oro\u3000laminado', 'Casa\u2009Uno'),
        fila('AF02', 'ANILLOS', 'ORO\u3000LAMINADO', 'CASA\u2009UNO'),
        fila('AF03', ' anillos ', 'oro laminado', 'casa uno'),
      ].join('\n'),
    );
    expect(errores).toEqual([]);
    await app((db) => altaLote(db, filas));
    const fichas = await Promise.all(
      ['AF01', 'AF02', 'AF03'].map((c) => app((db) => obtenerPiezaPorCodigo(db, c))),
    );
    for (const f of fichas) {
      expect(f?.categoriaNombre).toBeTruthy();
      expect(f?.materialNombre).toBeTruthy();
      expect(f?.proveedorNombre).toBeTruthy();
    }
    expect(new Set(fichas.map((f) => f!.categoriaId)).size).toBe(1);
  });
  it('rechaza lotes sin filas o con más de 500 filas', async () => {
    await expect(app((db) => altaLote(db, []))).rejects.toThrow('El lote no tiene piezas.');
    const filas = Array.from({ length: 501 }, (_, i) => ({
      linea: i + 1,
      codigo: `ZZ${i + 1}`,
      categoria: 'Anillos',
      descripcion: 'x',
      material: null,
      proveedor: null,
      costoCentavos: 0,
      precioCentavos: 100,
    }));
    await expect(app((db) => altaLote(db, filas))).rejects.toThrow('Máximo 500 piezas por lote.');
  });
  it('crea todas las piezas del lote', async () => {
    const { filas } = parsearLote(
      ['AC01', 'AC02'].map((c) => [c, 'Collares', 'Collar', '', '', '', '199'].join('\t')).join('\n'),
    );
    expect(await app((db) => altaLote(db, filas))).toEqual({ creadas: 2 });
  });
});

describe('cambios de estado manuales (R-03, R-06)', () => {
  it('disponible → defecto → disponible deja historial con nota', async () => {
    await app((db) => altaPieza(db, { ...base, codigo: 'AD01' }));
    let f = (await app((db) => obtenerPiezaPorCodigo(db, 'AD01')))!;
    await app((db) =>
      cambiarEstado(db, { piezaId: f.id, version: f.version, aEstado: 'defecto', nota: 'Broche roto' }),
    );
    f = (await app((db) => obtenerPiezaPorCodigo(db, 'AD01')))!;
    await app((db) => cambiarEstado(db, { piezaId: f.id, version: f.version, aEstado: 'disponible' }));
    const h = await app((db) => historial(db, f.id));
    expect(h.map((m) => [m.tipo, m.deEstado, m.aEstado, m.nota])).toEqual([
      ['cambio_estado', 'defecto', 'disponible', null],
      ['cambio_estado', 'disponible', 'defecto', 'Broche roto'],
      ['alta', null, 'disponible', null],
    ]);
  });
  it('rechaza transiciones inválidas y versiones viejas', async () => {
    await app((db) => altaPieza(db, { ...base, codigo: 'AD02' }));
    const f = (await app((db) => obtenerPiezaPorCodigo(db, 'AD02')))!;
    await app((db) => cambiarEstado(db, { piezaId: f.id, version: f.version, aEstado: 'regalo' }));
    await expect(
      app((db) => cambiarEstado(db, { piezaId: f.id, version: f.version + 1, aEstado: 'defecto' })),
    ).rejects.toThrow('Ese cambio de estado no está permitido para la pieza.');
    await expect(
      app((db) => cambiarEstado(db, { piezaId: f.id, version: f.version, aEstado: 'disponible' })),
    ).rejects.toThrow('Otra pestaña modificó este registro');
  });
});

describe('transiciones manuales acotadas', () => {
  async function enExhibidor(codigo: string) {
    await app((db) => altaPieza(db, { ...base, codigo }));
    const f = (await app((db) => obtenerPiezaPorCodigo(db, codigo)))!;
    await app(async (db) => {
      const vid = await crearVendedor(db, { nombre: 'Rosa', tipo: 'revendedora', comisionPct: '20' });
      const [ex] = await db
        .insert(exhibidor)
        .values({ vendedorId: vid, nombre: 'Exhibidor Rosa', fechaEnvio: '2026-10-09' })
        .returning({ id: exhibidor.id });
      await db.update(pieza).set({ estado: 'en_exhibidor', exhibidorId: ex!.id }).where(eq(pieza.id, f.id));
    });
    return (await app((db) => obtenerPiezaPorCodigo(db, codigo)))!;
  }
  it('en_exhibidor → disponible no es un cambio manual', async () => {
    const f = await enExhibidor('AG01');
    await expect(
      app((db) => cambiarEstado(db, { piezaId: f.id, version: f.version, aEstado: 'disponible' })),
    ).rejects.toThrow('Ese cambio de estado no está permitido para la pieza.');
  });
  it('disponible → disponible se rechaza', async () => {
    await app((db) => altaPieza(db, { ...base, codigo: 'AG02' }));
    const f = (await app((db) => obtenerPiezaPorCodigo(db, 'AG02')))!;
    await expect(
      app((db) => cambiarEstado(db, { piezaId: f.id, version: f.version, aEstado: 'disponible' })),
    ).rejects.toThrow('Ese cambio de estado no está permitido para la pieza.');
  });
  it('en_exhibidor → defecto libera el exhibidor y lo deja en el historial', async () => {
    const f = await enExhibidor('AG03');
    await app((db) => cambiarEstado(db, { piezaId: f.id, version: f.version, aEstado: 'defecto' }));
    const despues = (await app((db) => obtenerPiezaPorCodigo(db, 'AG03')))!;
    expect(despues.estado).toBe('defecto');
    expect(despues.exhibidorNombre).toBeNull();
    const h = await app((db) => historial(db, f.id));
    expect(h[0]).toMatchObject({
      deEstado: 'en_exhibidor',
      aEstado: 'defecto',
      exhibidorNombre: 'Exhibidor Rosa',
    });
  });
});

describe('listado', () => {
  it('filtra por código, descripción sin acentos y estado', async () => {
    await app((db) => altaPieza(db, { ...base, codigo: 'AE01', descripcion: 'Collar corazón mamá' }));
    await app((db) => altaPieza(db, { ...base, codigo: 'AE02', descripcion: 'Pulsera hilo' }));
    expect((await app((db) => listarPiezas(db, { q: 'corazon' }))).map((p) => p.codigo)).toEqual(['AE01']);
    expect((await app((db) => listarPiezas(db, { q: 'ae0' }))).map((p) => p.codigo)).toEqual([
      'AE01',
      'AE02',
    ]);
    expect(await app((db) => listarPiezas(db, { estado: 'vendida' }))).toEqual([]);
  });
});
