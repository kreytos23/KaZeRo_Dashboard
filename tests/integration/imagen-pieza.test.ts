import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pgConstraint } from '@/db/errors';
import { pieza, vPieza } from '@/db/schema';
import { rutaImagen } from '@/domain/imagenes';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { ErrorNegocio, traducirErrorPg } from '@/server/errores';
import { procesarImagen } from '@/server/imagenes/procesar';
import {
  altaPiezaConFoto,
  cambiarImagenPieza,
  claveImagenDePieza,
  quitarImagenPieza,
} from '@/server/piezas/imagen';
import { altaPieza, listarPiezas, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { crearAlmacenMemoria } from '../apoyo/almacen-memoria';
import { jpegDePrueba } from '../apoyo/imagenes';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);
const base = { categoria: 'Anillos', descripcion: 'Anillo luna', costoCentavos: 0, precioCentavos: 14900 };

let adminId: string;
beforeEach(async () => {
  adminId = await reiniciarConAdmin();
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

  it('dos piezas no pueden compartir la misma clave de foto (índice único)', async () => {
    const a = await app((db) => altaPieza(db, { ...base, codigo: 'IM06' }));
    const b = await app((db) => altaPieza(db, { ...base, codigo: 'IM07' }));
    const clave = randomUUID();
    await fijarFoto(a.id, clave);
    const e = await capturar(() => fijarFoto(b.id, clave));
    expect(pgConstraint(e)).toBe('pieza_imagen_clave_uq');
    expect(traducirErrorPg(e)?.campo).toBe('imagen');
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

const ficha = (codigo: string) => app((db) => obtenerPiezaPorCodigo(db, codigo)).then((f) => f!);
let foto: Awaited<ReturnType<typeof procesarImagen>>;
beforeAll(async () => {
  // procesarImagen real (sharp): la misma ruta que usa la Server Action.
  foto = await procesarImagen(await jpegDePrueba({ gps: true }));
});

describe('cambiar y quitar la foto (R-38, D6)', () => {
  it('sube grande y mini, apunta la pieza, sube la versión y deja "agregada" en el historial', async () => {
    const almacen = crearAlmacenMemoria();
    await app((db) => altaPieza(db, { ...base, codigo: 'FT01' }));
    const p = await ficha('FT01');
    await app((db) =>
      cambiarImagenPieza(db, almacen, { piezaId: p.id, version: p.version, adminId, imagen: foto }),
    );
    const q = await ficha('FT01');
    expect(q.version).toBe(p.version + 1);
    expect(q.imagenClave).toMatch(/^[0-9a-f-]{36}$/);
    expect(almacen.rutas()).toEqual(
      [rutaImagen(p.id, q.imagenClave!, 'grande'), rutaImagen(p.id, q.imagenClave!, 'mini')].sort(),
    );
    expect(almacen.bytes(rutaImagen(p.id, q.imagenClave!, 'grande'))).toEqual(foto.grande);
    expect(almacen.bytes(rutaImagen(p.id, q.imagenClave!, 'mini'))).toEqual(foto.mini);
    const [h] = await app((db) => historialDeCambios(db, 'pieza', p.id));
    expect(h!.campos).toEqual([{ campo: 'imagen_clave', antes: null, despues: q.imagenClave }]);
    const [fila] = await app((db) => listarPiezas(db, { q: 'FT01' }));
    expect(fila!.imagenClave).toBe(q.imagenClave);
  });

  it('cambiarla borra los blobs viejos después del COMMIT', async () => {
    const almacen = crearAlmacenMemoria();
    await app((db) => altaPieza(db, { ...base, codigo: 'FT02' }));
    const p = await ficha('FT02');
    await app((db) =>
      cambiarImagenPieza(db, almacen, { piezaId: p.id, version: p.version, adminId, imagen: foto }),
    );
    const q = await ficha('FT02');
    await app((db) =>
      cambiarImagenPieza(db, almacen, { piezaId: p.id, version: q.version, adminId, imagen: foto }),
    );
    const r = await ficha('FT02');
    expect(r.imagenClave).not.toBe(q.imagenClave);
    expect(almacen.rutas()).toEqual(
      [rutaImagen(p.id, r.imagenClave!, 'grande'), rutaImagen(p.id, r.imagenClave!, 'mini')].sort(),
    );
    const [h] = await app((db) => historialDeCambios(db, 'pieza', p.id));
    expect(h!.campos).toEqual([{ campo: 'imagen_clave', antes: q.imagenClave, despues: r.imagenClave }]);
  });

  it('versión vieja → conflicto y NO sube nada (verificación previa)', async () => {
    const almacen = crearAlmacenMemoria();
    const guardar = vi.spyOn(almacen, 'guardar');
    await app((db) => altaPieza(db, { ...base, codigo: 'FT03' }));
    const p = await ficha('FT03');
    await expect(
      app((db) =>
        cambiarImagenPieza(db, almacen, { piezaId: p.id, version: p.version + 5, adminId, imagen: foto }),
      ),
    ).rejects.toMatchObject({ codigo: 'conflicto' });
    expect(guardar).not.toHaveBeenCalled();
    expect((await ficha('FT03')).version).toBe(p.version);
  });

  it('pieza inexistente → no_encontrada y no sube nada', async () => {
    const almacen = crearAlmacenMemoria();
    await expect(
      app((db) =>
        cambiarImagenPieza(db, almacen, { piezaId: randomUUID(), version: 1, adminId, imagen: foto }),
      ),
    ).rejects.toMatchObject({ codigo: 'no_encontrada' });
    expect(almacen.rutas()).toEqual([]);
  });

  it('dos pestañas a la vez: una gana; la otra falla y sus blobs se borran (la BD nunca apunta a un blob inexistente)', async () => {
    const almacen = crearAlmacenMemoria();
    await app((db) => altaPieza(db, { ...base, codigo: 'FT04' }));
    const p = await ficha('FT04');
    const d = { piezaId: p.id, version: p.version, adminId, imagen: foto };
    const r = await Promise.allSettled([
      app((db) => cambiarImagenPieza(db, almacen, d)),
      app((db) => cambiarImagenPieza(db, almacen, d)),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const perdedor = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(perdedor.reason).toMatchObject({ codigo: 'conflicto' });
    const q = await ficha('FT04');
    expect(almacen.rutas()).toEqual(
      [rutaImagen(p.id, q.imagenClave!, 'grande'), rutaImagen(p.id, q.imagenClave!, 'mini')].sort(),
    );
  });

  it('si el almacén falla al subir, la pieza no cambia y el error va al campo imagen', async () => {
    await app((db) => altaPieza(db, { ...base, codigo: 'FT05' }));
    const p = await ficha('FT05');
    await expect(
      app((db) =>
        cambiarImagenPieza(db, crearAlmacenMemoria({ fallarAlGuardar: true }), {
          piezaId: p.id,
          version: p.version,
          adminId,
          imagen: foto,
        }),
      ),
    ).rejects.toMatchObject({ campo: 'imagen', message: 'No se pudo guardar la foto. Intenta de nuevo.' });
    const q = await ficha('FT05');
    expect(q.version).toBe(p.version);
    expect(q.imagenClave).toBeNull();
  });

  it('si falla borrar la foto vieja, el cambio igual se guarda (best effort)', async () => {
    const almacen = crearAlmacenMemoria();
    await app((db) => altaPieza(db, { ...base, codigo: 'FT06' }));
    const p = await ficha('FT06');
    await app((db) =>
      cambiarImagenPieza(db, almacen, { piezaId: p.id, version: p.version, adminId, imagen: foto }),
    );
    const q = await ficha('FT06');
    const sinBorrar = Object.assign(Object.create(almacen), {
      borrar: async () => {
        throw new Error('BlobServiceNotAvailable');
      },
    });
    await app((db) =>
      cambiarImagenPieza(db, sinBorrar, { piezaId: p.id, version: q.version, adminId, imagen: foto }),
    );
    expect((await ficha('FT06')).imagenClave).not.toBe(q.imagenClave);
  });

  it('quitar: deja la pieza sin foto, borra los blobs y registra "quitada"; quitar sin foto → sin cambios', async () => {
    const almacen = crearAlmacenMemoria();
    await app((db) => altaPieza(db, { ...base, codigo: 'FT07' }));
    const p = await ficha('FT07');
    expect(
      await app((db) => quitarImagenPieza(db, almacen, { piezaId: p.id, version: p.version, adminId })),
    ).toEqual({
      cambios: 0,
      codigo: 'FT07',
    });
    expect((await ficha('FT07')).version).toBe(p.version);
    await app((db) =>
      cambiarImagenPieza(db, almacen, { piezaId: p.id, version: p.version, adminId, imagen: foto }),
    );
    const q = await ficha('FT07');
    expect(
      await app((db) => quitarImagenPieza(db, almacen, { piezaId: p.id, version: q.version, adminId })),
    ).toEqual({
      cambios: 1,
      codigo: 'FT07',
    });
    const r = await ficha('FT07');
    expect(r.imagenClave).toBeNull();
    expect(r.version).toBe(q.version + 1);
    expect(almacen.rutas()).toEqual([]);
    const [h] = await app((db) => historialDeCambios(db, 'pieza', p.id));
    expect(h!.campos).toEqual([{ campo: 'imagen_clave', antes: q.imagenClave, despues: null }]);
  });

  it('quitar con versión vieja → conflicto y los blobs siguen', async () => {
    const almacen = crearAlmacenMemoria();
    await app((db) => altaPieza(db, { ...base, codigo: 'FT10' }));
    const p = await ficha('FT10');
    await app((db) =>
      cambiarImagenPieza(db, almacen, { piezaId: p.id, version: p.version, adminId, imagen: foto }),
    );
    await expect(
      app((db) => quitarImagenPieza(db, almacen, { piezaId: p.id, version: p.version, adminId })),
    ).rejects.toMatchObject({ codigo: 'conflicto' });
    expect(almacen.rutas()).toHaveLength(2);
    expect((await ficha('FT10')).imagenClave).not.toBeNull();
  });

  it('la foto de una pieza vendida se puede subir con el servicio', async () => {
    const almacen = crearAlmacenMemoria();
    const { id } = await app((db) => altaPieza(db, { ...base, codigo: 'FT11' }));
    await owner(async (db) => {
      await db.update(pieza).set({ estado: 'apartada' }).where(eq(pieza.id, id));
      await db.update(pieza).set({ estado: 'vendida' }).where(eq(pieza.id, id));
    });
    const p = await ficha('FT11');
    await app((db) =>
      cambiarImagenPieza(db, almacen, { piezaId: id, version: p.version, adminId, imagen: foto }),
    );
    const q = await ficha('FT11');
    expect(q.estado).toBe('vendida');
    expect(q.imagenClave).not.toBeNull();
  });

  it('alta con foto: pieza y blobs juntos; si el código ya existe, no quedan blobs', async () => {
    const almacen = crearAlmacenMemoria();
    const { id } = await app((db) => altaPiezaConFoto(db, almacen, { ...base, codigo: 'FT08' }, foto));
    const clave = await app((db) => claveImagenDePieza(db, id));
    expect(almacen.rutas()).toEqual(
      [rutaImagen(id, clave!, 'grande'), rutaImagen(id, clave!, 'mini')].sort(),
    );
    await expect(
      app((db) => altaPiezaConFoto(db, almacen, { ...base, codigo: 'FT08' }, foto)),
    ).rejects.toBeInstanceOf(ErrorNegocio);
    expect(almacen.rutas()).toHaveLength(2);
  });

  it('alta con foto: si el almacén falla, no se crea la pieza', async () => {
    await expect(
      app((db) =>
        altaPiezaConFoto(
          db,
          crearAlmacenMemoria({ fallarAlGuardar: true }),
          { ...base, codigo: 'FT12' },
          foto,
        ),
      ),
    ).rejects.toMatchObject({ campo: 'imagen' });
    expect(await app((db) => obtenerPiezaPorCodigo(db, 'FT12'))).toBeNull();
  });

  /** El COMMIT se aplica pero la respuesta se pierde (red): la transacción "falla" después de confirmar. */
  const respuestaPerdida = <T extends object>(db: T): T =>
    Object.assign(Object.create(db), {
      transaction: async (fn: never) => {
        await (db as unknown as { transaction: (f: never) => Promise<unknown> }).transaction(fn);
        throw new Error('ECONNRESET');
      },
    });

  it('si el COMMIT se aplicó pero la respuesta se perdió, NO se borran los blobs nuevos (re-lectura)', async () => {
    const almacen = crearAlmacenMemoria();
    await app((db) => altaPieza(db, { ...base, codigo: 'FT13' }));
    const p = await ficha('FT13');
    await expect(
      app((db) =>
        cambiarImagenPieza(respuestaPerdida(db), almacen, {
          piezaId: p.id,
          version: p.version,
          adminId,
          imagen: foto,
        }),
      ),
    ).rejects.toThrow('ECONNRESET');
    const q = await ficha('FT13');
    expect(q.imagenClave).not.toBeNull();
    expect(almacen.rutas()).toEqual(
      [rutaImagen(p.id, q.imagenClave!, 'grande'), rutaImagen(p.id, q.imagenClave!, 'mini')].sort(),
    );
  });

  it('alta con foto: COMMIT aplicado y respuesta perdida → la pieza conserva sus blobs', async () => {
    const almacen = crearAlmacenMemoria();
    await expect(
      app((db) => altaPiezaConFoto(respuestaPerdida(db), almacen, { ...base, codigo: 'FT14' }, foto)),
    ).rejects.toThrow('ECONNRESET');
    const q = await ficha('FT14');
    expect(almacen.rutas()).toEqual(
      [rutaImagen(q.id, q.imagenClave!, 'grande'), rutaImagen(q.id, q.imagenClave!, 'mini')].sort(),
    );
  });

  it('alta sin foto se comporta como antes', async () => {
    const almacen = crearAlmacenMemoria();
    const { id } = await app((db) => altaPiezaConFoto(db, almacen, { ...base, codigo: 'FT09' }, null));
    expect(await app((db) => claveImagenDePieza(db, id))).toBeNull();
    expect(almacen.rutas()).toEqual([]);
  });
});
