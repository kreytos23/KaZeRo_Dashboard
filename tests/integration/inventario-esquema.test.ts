import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pgCode } from '@/db/errors';
import { categoria, movimientoPieza, pieza } from '@/db/schema';
import { normalizar } from '@/domain/texto';
import { traducirErrorPg } from '@/server/errores';
import { truncarTodo, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);

async function capturar(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

async function piezaBase(codigo = 'AA01') {
  return app(async (db) => {
    const [c] = await db.insert(categoria).values({ nombre: 'Anillos' }).returning({ id: categoria.id });
    const [p] = await db
      .insert(pieza)
      .values({
        codigo,
        categoriaId: c!.id,
        descripcion: 'Anillo',
        precio: '149.00',
        fechaAlta: '2026-10-09',
      })
      .returning({ id: pieza.id });
    return p!.id;
  });
}

beforeEach(truncarTodo);

describe('reglas de inventario en la BD', () => {
  it('kz_normalizar coincide con normalizar() de TS (misma unicidad y búsqueda en ambos lados)', async () => {
    const entradas = [
      '  Rocío   SANTIBAÑEZ ',
      '\tabc\n',
      'straße Ø Łódź',
      'a\u00A0\u00A0b',
      'ÁÉÍÓÚ Üñ',
      'Oro  LAMINADO',
    ];
    const r = await app((db) =>
      db.execute<{ e: string; n: string }>(
        sql`SELECT e, kz_normalizar(e) AS n FROM unnest(ARRAY[${sql.join(
          entradas.map((x) => sql`${x}`),
          sql`, `,
        )}]::text[]) WITH ORDINALITY AS u(e, o) ORDER BY o`,
      ),
    );
    expect(r.rows.map((f) => f.n)).toEqual(entradas.map(normalizar));
  });

  it('catálogos únicos sin importar mayúsculas, acentos ni espacios', async () => {
    await app((db) => db.insert(categoria).values({ nombre: 'Oro laminado' }));
    const e = await capturar(() => app((db) => db.insert(categoria).values({ nombre: '  ORO   LÁMINADO ' })));
    expect(traducirErrorPg(e)?.codigo).toBe('categoria_nombre_uq');
  });

  it('el código de pieza debe venir normalizado en mayúsculas', async () => {
    const e = await capturar(() => piezaBase('aa01'));
    expect(traducirErrorPg(e)?.codigo).toBe('pieza_codigo_formato');
  });

  it('rechaza transiciones de estado no permitidas (R-03)', async () => {
    const id = await piezaBase();
    const e = await capturar(() =>
      app((db) => db.update(pieza).set({ estado: 'vendida' }).where(eq(pieza.id, id))),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('pieza_transicion');
  });

  it('permite transiciones válidas: disponible → defecto → disponible', async () => {
    const id = await piezaBase();
    await app((db) => db.update(pieza).set({ estado: 'defecto' }).where(eq(pieza.id, id)));
    await app((db) => db.update(pieza).set({ estado: 'disponible' }).where(eq(pieza.id, id)));
  });

  it('una pieza en exhibidor exige exhibidor', async () => {
    const id = await piezaBase();
    const e = await capturar(() =>
      app((db) => db.update(pieza).set({ estado: 'en_exhibidor' }).where(eq(pieza.id, id))),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('pieza_exhibidor_coherente');
  });

  it('el historial es de solo inserción para kazero_app (R-06)', async () => {
    const id = await piezaBase();
    await app((db) =>
      db.insert(movimientoPieza).values({ piezaId: id, tipo: 'alta', aEstado: 'disponible' }),
    );
    const upd = await capturar(() => app((db) => db.update(movimientoPieza).set({ nota: 'x' })));
    const del = await capturar(() => app((db) => db.delete(movimientoPieza)));
    expect(pgCode(upd)).toBe('42501');
    expect(pgCode(del)).toBe('42501');
  });

  it('kazero_app no puede borrar piezas', async () => {
    await piezaBase();
    expect(pgCode(await capturar(() => app((db) => db.delete(pieza))))).toBe('42501');
  });

  it('la BD rechaza textos fuera de rango aunque la app no valide (CHECK)', async () => {
    const e = await capturar(() => app((db) => db.insert(categoria).values({ nombre: 'x'.repeat(81) })));
    expect(traducirErrorPg(e)?.codigo).toBe('categoria_nombre_largo');
  });

  it('updated_at lo mantiene un trigger', async () => {
    const id = await piezaBase();
    const antes = await app((db) =>
      db.execute<{ u: string }>(sql`SELECT updated_at::text AS u FROM pieza WHERE id = ${id}`),
    );
    await app((db) => db.update(pieza).set({ estado: 'guardada' }).where(eq(pieza.id, id)));
    const despues = await app((db) =>
      db.execute<{ u: string }>(sql`SELECT updated_at::text AS u FROM pieza WHERE id = ${id}`),
    );
    expect(despues.rows[0]!.u > antes.rows[0]!.u).toBe(true);
  });
});

describe('buenas prácticas del esquema (lecciones §3)', () => {
  it('toda llave foránea tiene un índice que empieza por sus columnas', async () => {
    const r = await conDbUrl(urlOwner(), (db) =>
      db.execute<{ tabla: string; fk: string }>(sql`
        SELECT c.conrelid::regclass::text AS tabla, c.conname AS fk
        FROM pg_constraint c
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
            WHERE i.indrelid = c.conrelid
              AND (SELECT array_agg(k ORDER BY o) FROM unnest(i.indkey::int2[]) WITH ORDINALITY u(k, o)
                   WHERE o <= cardinality(c.conkey)) = c.conkey)`),
    );
    expect(r.rows).toEqual([]);
  });

  it('las 6 vistas de lectura usan security_invoker y kazero_app puede leerlas', async () => {
    const r = await conDbUrl(urlOwner(), (db) =>
      db.execute<{ vista: string; invoker: boolean; lectura: boolean }>(sql`
        SELECT c.relname AS vista,
               coalesce('security_invoker=true' = ANY (c.reloptions), false) AS invoker,
               has_table_privilege('kazero_app', c.oid, 'SELECT') AS lectura
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v' ORDER BY c.relname`),
    );
    expect(r.rows.map((f) => f.vista)).toEqual([
      'v_catalogo',
      'v_cliente',
      'v_exhibidor',
      'v_movimiento_pieza',
      'v_pieza',
      'v_vendedor',
    ]);
    for (const f of r.rows) expect(f).toMatchObject({ invoker: true, lectura: true });
  });
});
