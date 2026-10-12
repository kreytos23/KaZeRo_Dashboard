import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pgConstraint } from '@/db/errors';
import { pieza, vPieza } from '@/db/schema';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { adminDePrueba, truncarTodo, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);
const base = { categoria: 'Anillos', descripcion: 'Anillo luna', costoCentavos: 0, precioCentavos: 14900 };

let adminId: string;
beforeEach(async () => {
  await truncarTodo();
  adminId = await adminDePrueba();
});

async function capturar(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** Cambia la foto como lo hará el servicio: contexto de auditoría local a la transacción, sin motivo. */
function fijarFoto(id: string, clave: string | null) {
  return app((db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('kazero.admin_id', ${adminId}, true)`);
      await tx.update(pieza).set({ imagenClave: clave }).where(eq(pieza.id, id));
    }),
  );
}

describe('esquema de la foto (0010/0011)', () => {
  it('kazero_app actualiza imagen_clave con contexto y queda en la bitácora sin motivo', async () => {
    const { id } = await app((db) => altaPieza(db, { ...base, codigo: 'IM01' }));
    const clave = randomUUID();
    await fijarFoto(id, clave);
    const [h] = await app((db) => historialDeCambios(db, 'pieza', id));
    expect(h!.motivo).toBeNull();
    expect(h!.campos).toEqual([{ campo: 'imagen_clave', antes: null, despues: clave }]);
  });

  it('cambiar y quitar la foto también quedan en la bitácora; repetir la misma clave no', async () => {
    const { id } = await app((db) => altaPieza(db, { ...base, codigo: 'IM04' }));
    const [a, b] = [randomUUID(), randomUUID()];
    await fijarFoto(id, a);
    await fijarFoto(id, b);
    await fijarFoto(id, b);
    await fijarFoto(id, null);
    const h = await app((db) => historialDeCambios(db, 'pieza', id));
    expect(h.map((e) => e.campos)).toEqual([
      [{ campo: 'imagen_clave', antes: b, despues: null }],
      [{ campo: 'imagen_clave', antes: a, despues: b }],
      [{ campo: 'imagen_clave', antes: null, despues: a }],
    ]);
  });

  it('sin contexto de auditoría, cambiar la foto falla (fail-closed)', async () => {
    const { id } = await app((db) => altaPieza(db, { ...base, codigo: 'IM02' }));
    const e = await capturar(() =>
      app((db) => db.update(pieza).set({ imagenClave: randomUUID() }).where(eq(pieza.id, id))),
    );
    expect(pgConstraint(e)).toBe('auditoria_sin_admin');
  });

  it('la foto de una pieza vendida se puede cambiar (no es un cambio de estado ni de dinero)', async () => {
    const { id } = await app((db) => altaPieza(db, { ...base, codigo: 'IM05' }));
    await owner(async (db) => {
      await db.update(pieza).set({ estado: 'apartada' }).where(eq(pieza.id, id));
      await db.update(pieza).set({ estado: 'vendida' }).where(eq(pieza.id, id));
    });
    const clave = randomUUID();
    await fijarFoto(id, clave);
    const [f] = await app((db) =>
      db.select({ clave: vPieza.imagenClave, estado: vPieza.estado }).from(vPieza).where(eq(vPieza.id, id)),
    );
    expect(f).toEqual({ clave, estado: 'vendida' });
  });

  it('v_pieza expone imagen_clave (listas y buscador sin consultas por fila)', async () => {
    const { id } = await app((db) => altaPieza(db, { ...base, codigo: 'IM03' }));
    const [f] = await app((db) =>
      db.select({ clave: vPieza.imagenClave }).from(vPieza).where(eq(vPieza.id, id)),
    );
    expect(f).toEqual({ clave: null });
  });

  it('v_pieza conserva security_invoker y sus columnas anteriores en el mismo orden, con imagen_clave al final', async () => {
    const r = await owner((db) =>
      db.execute<{ columnas: string[]; opciones: string[] | null }>(sql`
        SELECT (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columnas,
               c.reloptions AS opciones
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'v_pieza'`),
    );
    expect(r.rows).toEqual([
      {
        columnas: [
          'id',
          'codigo',
          'descripcion',
          'costo',
          'precio',
          'fecha_alta',
          'estado',
          'version',
          'categoria_id',
          'categoria_nombre',
          'material_id',
          'material_nombre',
          'proveedor_id',
          'proveedor_nombre',
          'exhibidor_id',
          'exhibidor_nombre',
          'imagen_clave',
        ],
        opciones: ['security_invoker=true'],
      },
    ]);
  });
});
