import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { categoria } from '@/db/schema';
import { ErrorNegocio } from '@/server/errores';
import { conIdempotencia, limpiarIdempotencia } from '@/server/idempotencia';
import { adminDePrueba, truncarTodo, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);

let adminId: string;
let otroAdminId: string;

/** Operación de prueba: inserta una categoría y devuelve un DTO no trivial, todo dentro de conIdempotencia. */
function crear(
  key: string,
  nombre: string,
  o: { falla?: boolean; operacion?: string; admin?: string; antes?: () => Promise<void> } = {},
) {
  return app((db) =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key, adminId: o.admin ?? adminId, operacion: o.operacion ?? 'prueba', payload: { nombre } },
        async () => {
          const [c] = await tx.insert(categoria).values({ nombre }).returning({ id: categoria.id });
          await o.antes?.();
          if (o.falla) throw new ErrorNegocio('x', 'falla a propósito');
          return {
            id: c!.id,
            nombre,
            lineas: [
              { n: 1, ok: true, nota: null },
              { n: 2, ok: false, nota: 'x' },
            ],
            extra: { a: [] },
          };
        },
      ),
    ),
  );
}
const cuantas = () =>
  app(
    async (db) => (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM categoria`)).rows[0]!.n,
  );

beforeEach(async () => {
  await truncarTodo();
  adminId = await adminDePrueba('a@kazero.test');
  otroAdminId = await adminDePrueba('b@kazero.test');
});

describe('conIdempotencia (R-37)', () => {
  it('la misma key y el mismo payload dan un solo efecto y un resultado idéntico (toEqual)', async () => {
    const key = randomUUID();
    const a = await crear(key, 'Anillos');
    const b = await crear(key, 'Anillos');
    expect(b).toEqual(a);
    expect(await cuantas()).toBe(1);
  });

  it('la misma key con otro payload se rechaza', async () => {
    const key = randomUUID();
    await crear(key, 'Anillos');
    await expect(crear(key, 'Aretes')).rejects.toThrow(
      'Este formulario ya se envió con otros datos. Recarga la página.',
    );
    expect(await cuantas()).toBe(1);
  });

  it('la misma key con otra operación se rechaza con su propio mensaje', async () => {
    const key = randomUUID();
    await crear(key, 'Anillos');
    await expect(crear(key, 'Anillos', { operacion: 'otra' })).rejects.toThrow(
      'Esta clave de envío ya se usó en otra operación. Recarga la página.',
    );
    expect(await cuantas()).toBe(1);
  });

  it('otro administrador con la misma key nunca recibe el resultado ajeno', async () => {
    const key = randomUUID();
    await crear(key, 'Anillos');
    await expect(crear(key, 'Anillos', { admin: otroAdminId })).rejects.toThrow('Solicitud inválida.');
    expect(await cuantas()).toBe(1);
  });

  it('una key que no es uuid se rechaza antes de tocar la BD', async () => {
    await expect(crear('no-es-uuid', 'Anillos')).rejects.toThrow('Solicitud inválida.');
    expect(await cuantas()).toBe(0);
  });

  it('un resultado con Date no se guarda (no es JSON seguro)', async () => {
    const key = randomUUID();
    const r = app((db) =>
      db.transaction((tx) =>
        conIdempotencia(tx, { key, adminId, operacion: 'prueba', payload: {} }, async () => ({
          f: new Date() as unknown as string,
        })),
      ),
    );
    await expect(r).rejects.toThrow(/JSON seguro/);
  });

  it('si la operación falla, la key no queda guardada y el reintento funciona', async () => {
    const key = randomUUID();
    await expect(crear(key, 'Anillos', { falla: true })).rejects.toThrow('falla a propósito');
    expect(await cuantas()).toBe(0);
    await crear(key, 'Anillos');
    expect(await cuantas()).toBe(1);
  });

  it('dos envíos simultáneos con la misma key producen un solo efecto', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([crear(key, 'Collares'), crear(key, 'Collares')]);
    expect(a).toEqual(b);
    expect(await cuantas()).toBe(1);
  });

  it('entrelazado forzado: el segundo INSERT espera a que el primero confirme y devuelve su resultado', async () => {
    const key = randomUUID();
    let liberar!: () => void;
    const latch = new Promise<void>((r) => (liberar = r));
    let dentro!: () => void;
    const primeroDentro = new Promise<void>((r) => (dentro = r));

    const primero = crear(key, 'Pulseras', {
      antes: async () => {
        dentro();
        await latch;
      },
    });
    await primeroDentro; // el primero ya insertó su clave y sigue sin confirmar
    const segundo = crear(key, 'Pulseras');

    // Esperar (con tope) a que el segundo esté bloqueado en el INSERT de la clave.
    let bloqueado = false;
    for (let i = 0; i < 100 && !bloqueado; i++) {
      const r = await owner((db) =>
        db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%insert into "idempotencia"%'`,
        ),
      );
      bloqueado = r.rows[0]!.n > 0;
      if (!bloqueado) await new Promise((r2) => setTimeout(r2, 50));
    }
    expect(bloqueado).toBe(true);
    liberar();
    const [a, b] = await Promise.all([primero, segundo]);
    expect(b).toEqual(a);
    expect(await cuantas()).toBe(1);
  });
});

describe('limpiarIdempotencia', () => {
  it('borra las claves de más de 30 días y conserva las recientes', async () => {
    const vieja = randomUUID();
    const reciente = randomUUID();
    await crear(vieja, 'A');
    await crear(reciente, 'B');
    await owner((db) =>
      db.execute(sql`UPDATE idempotencia SET created_at = now() - interval '31 days' WHERE key = ${vieja}`),
    );
    expect(await app((db) => limpiarIdempotencia(db))).toBe(1);
    const claves = await owner(
      async (db) => (await db.execute<{ key: string }>(sql`SELECT key FROM idempotencia`)).rows,
    );
    expect(claves.map((c) => c.key)).toEqual([reciente]);
  });
});
