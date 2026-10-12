import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { categoria } from '@/db/schema';
import { ErrorNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import { truncarTodo, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);

/** Operación de prueba: inserta una categoría y devuelve su id, todo dentro de conIdempotencia. */
function crear(key: string, nombre: string, falla = false) {
  return app((db) =>
    db.transaction((tx) =>
      conIdempotencia(tx, { key, operacion: 'prueba', payload: { nombre } }, async () => {
        const [c] = await tx.insert(categoria).values({ nombre }).returning({ id: categoria.id });
        if (falla) throw new ErrorNegocio('x', 'falla a propósito');
        return { id: c!.id };
      }),
    ),
  );
}
const cuantas = () =>
  app(
    async (db) => (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM categoria`)).rows[0]!.n,
  );

beforeEach(truncarTodo);

describe('conIdempotencia (R-37)', () => {
  it('la misma key y el mismo payload dan un solo efecto y el mismo resultado', async () => {
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

  it('si la operación falla, la key no queda guardada y el reintento funciona', async () => {
    const key = randomUUID();
    await expect(crear(key, 'Anillos', true)).rejects.toThrow('falla a propósito');
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
});
