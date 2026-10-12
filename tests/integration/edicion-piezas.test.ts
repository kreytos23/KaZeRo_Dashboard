import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pieza } from '@/db/schema';
import { numericACentavos } from '@/domain/dinero';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { traducirErrorPg } from '@/server/errores';
import {
  altaPieza,
  editarPieza,
  obtenerPiezaPorCodigo,
  type EdicionPieza,
  type FichaPieza,
} from '@/server/piezas/servicio';
import { adminDePrueba, truncarTodo, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const base = {
  categoria: 'Anillos',
  material: 'Oro laminado',
  proveedor: 'ZABBEL',
  descripcion: 'Anillo serpiente con circonitas',
  costoCentavos: 6500,
  precioCentavos: 14900,
};

let adminId: string;
beforeEach(async () => {
  await truncarTodo();
  adminId = await adminDePrueba();
});

async function nueva(codigo = 'ED01'): Promise<FichaPieza> {
  await app((db) => altaPieza(db, { ...base, codigo }));
  return (await app((db) => obtenerPiezaPorCodigo(db, codigo)))!;
}
const ficha = (codigo = 'ED01') => app((db) => obtenerPiezaPorCodigo(db, codigo)).then((f) => f!);
const edicion = (p: FichaPieza, cambios: Partial<EdicionPieza> = {}): EdicionPieza => ({
  piezaId: p.id,
  version: p.version,
  adminId,
  categoria: p.categoriaNombre,
  material: p.materialNombre,
  proveedor: p.proveedorNombre,
  descripcion: p.descripcion,
  costoCentavos: numericACentavos(p.costo),
  precioCentavos: numericACentavos(p.precio),
  ...cambios,
});

describe('editar pieza con bitácora (R-08, R-09)', () => {
  it('guarda los cambios y su historial en la misma transacción, solo de lo que cambió', async () => {
    const p = await nueva();
    const r = await app((db) =>
      editarPieza(
        db,
        edicion(p, {
          descripcion: 'Anillo serpiente dorado',
          categoria: 'Anillos finos',
          precioCentavos: 19900,
          motivo: 'Subió el proveedor',
        }),
      ),
    );
    expect(r).toEqual({ cambios: 3, codigo: 'ED01' });
    expect(await ficha()).toMatchObject({
      descripcion: 'Anillo serpiente dorado',
      categoriaNombre: 'Anillos finos',
      precio: '199.00',
      version: p.version + 1,
    });
    const h = await app((db) => historialDeCambios(db, 'pieza', p.id));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ adminEmail: 'auditor@kazero.test', motivo: 'Subió el proveedor' });
    expect(h[0]!.campos).toEqual([
      { campo: 'descripcion', antes: 'Anillo serpiente con circonitas', despues: 'Anillo serpiente dorado' },
      { campo: 'categoria', antes: 'Anillos', despues: 'Anillos finos' },
      { campo: 'precio', antes: '149.00', despues: '199.00' },
    ]);
  });

  it('sin cambios no escribe nada ni sube la versión (no-op)', async () => {
    const p = await nueva();
    // "anillos" en minúsculas es la misma categoría (kz_normalizar): no cuenta como cambio.
    expect(await app((db) => editarPieza(db, edicion(p, { categoria: ' anillos ' })))).toEqual({
      cambios: 0,
      codigo: 'ED01',
    });
    expect((await ficha()).version).toBe(p.version);
    expect(await app((db) => historialDeCambios(db, 'pieza', p.id))).toEqual([]);
  });

  it('cambiar precio o costo exige motivo; cambiar solo texto, no', async () => {
    const p = await nueva();
    for (const cambio of [{ precioCentavos: 15900 }, { costoCentavos: 7000 }]) {
      await expect(app((db) => editarPieza(db, edicion(p, cambio)))).rejects.toMatchObject({
        codigo: 'motivo',
        campo: 'motivo',
      });
    }
    await app((db) => editarPieza(db, edicion(p, { descripcion: 'Anillo luna' })));
    const [e] = await app((db) => historialDeCambios(db, 'pieza', p.id));
    expect(e!.motivo).toBeNull();
  });

  it('material y proveedor vacíos se guardan como null y se registran', async () => {
    const p = await nueva();
    await app((db) => editarPieza(db, edicion(p, { material: '', proveedor: '  ' })));
    const [e] = await app((db) => historialDeCambios(db, 'pieza', p.id));
    expect(e!.campos).toEqual([
      { campo: 'material', antes: 'Oro laminado', despues: null },
      { campo: 'proveedor', antes: 'ZABBEL', despues: null },
    ]);
  });

  it('versión vieja → conflicto y no escribe nada', async () => {
    const p = await nueva();
    await app((db) => editarPieza(db, edicion(p, { descripcion: 'Primera' })));
    await expect(app((db) => editarPieza(db, edicion(p, { descripcion: 'Segunda' })))).rejects.toThrow(
      'Otra pestaña modificó este registro',
    );
    expect((await ficha()).descripcion).toBe('Primera');
  });

  it('no cambia el precio de una pieza apartada o vendida, pero sí su descripción y su costo (con motivo)', async () => {
    const p = await nueva();
    await conDbUrl(urlOwner(), (db) =>
      db.update(pieza).set({ estado: 'apartada' }).where(eq(pieza.id, p.id)),
    );
    await expect(
      app((db) => editarPieza(db, edicion(p, { precioCentavos: 19900, motivo: 'Promoción' }))),
    ).rejects.toMatchObject({ codigo: 'pieza_precio_bloqueado', campo: 'precio' });
    const r = await app((db) =>
      editarPieza(
        db,
        edicion(p, { descripcion: 'Anillo apartado', costoCentavos: 7000, motivo: 'Factura corregida' }),
      ),
    );
    expect(r.cambios).toBe(2);
  });

  it('el contexto de auditoría no se filtra a la siguiente transacción', async () => {
    const p = await nueva();
    await app(async (db) => {
      await editarPieza(db, edicion(p, { descripcion: 'Uno' }));
      let error: unknown = null;
      try {
        await db.transaction((tx) =>
          tx.execute(sql`UPDATE pieza SET descripcion = 'Dos' WHERE id = ${p.id}`),
        );
      } catch (e) {
        error = e;
      }
      expect(traducirErrorPg(error)?.codigo).toBe('auditoria_sin_admin');
    });
  });
});

describe('canonicalización de opcionales antes de comparar', () => {
  it("re-guardar con '' o espacios en lugar de null no escribe bitácora ni sube la versión", async () => {
    await app((db) =>
      altaPieza(db, {
        categoria: 'Anillos',
        descripcion: 'Sin material',
        costoCentavos: 100,
        precioCentavos: 200,
        codigo: 'ED09',
      }),
    );
    const p = await ficha('ED09');
    const e = (c: Partial<EdicionPieza>): EdicionPieza => ({
      piezaId: p.id,
      version: p.version,
      adminId,
      categoria: 'Anillos',
      descripcion: 'Sin material',
      costoCentavos: 100,
      precioCentavos: 200,
      ...c,
    });
    for (const c of [
      { material: '', proveedor: '' },
      { material: null, proveedor: null },
      { material: '   ', proveedor: undefined },
    ])
      expect(await app((db) => editarPieza(db, e(c)))).toEqual({ cambios: 0, codigo: 'ED09' });
    expect((await ficha('ED09')).version).toBe(p.version);
    expect(await app((db) => historialDeCambios(db, 'pieza', p.id))).toEqual([]);
  });
});
