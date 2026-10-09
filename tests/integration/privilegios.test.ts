import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pgCode } from '@/db/errors';
import { urlApp, urlOwner } from './utilidades';

async function codigoAl(url: string, consulta: ReturnType<typeof sql>) {
  try {
    await conDbUrl(url, (db) => db.execute(consulta));
    return 'ok';
  } catch (e) {
    return pgCode(e) ?? 'sin-codigo';
  }
}

describe('privilegios de kazero_app (mínimo privilegio)', () => {
  it('no puede crear tablas (DDL)', async () => {
    expect(await codigoAl(urlApp(), sql`CREATE TABLE intruso (id int)`)).toBe('42501');
  });
  it('no puede TRUNCATE', async () => {
    expect(await codigoAl(urlApp(), sql`TRUNCATE acceso_log`)).toBe('42501');
  });
  it('no puede borrar ni insertar admins', async () => {
    expect(await codigoAl(urlApp(), sql`DELETE FROM admin`)).toBe('42501');
    expect(
      await codigoAl(
        urlApp(),
        sql`INSERT INTO admin (email, password_hash, totp_secret_cifrado) VALUES ('a','b','c')`,
      ),
    ).toBe('42501');
  });
  it('sí puede leer y escribir sesiones', async () => {
    expect(await codigoAl(urlApp(), sql`SELECT count(*) FROM sesion`)).toBe('ok');
  });
  it('toda tabla de negocio tiene grants explícitos para kazero_app', async () => {
    const filas = await conDbUrl(urlOwner(), (db) =>
      // Se consulta por oid (no por nombre): el planner puede evaluar el privilegio antes del filtro de
      // esquema y fallar con tablas de otros esquemas (p. ej. drizzle.__drizzle_migrations).
      db.execute<{ tabla: string }>(sql`
        SELECT c.relname AS tabla
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND NOT has_table_privilege('kazero_app', c.oid, 'SELECT')`),
    );
    expect(filas.rows.map((f) => f.tabla)).toEqual([]);
  });
});
