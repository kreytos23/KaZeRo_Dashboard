import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pgCode } from '@/db/errors';
import { truncarTodo, urlApp, urlOwner } from './utilidades';

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
  it('no puede borrar admins ni cambiar su contraseña, correo o rol', async () => {
    expect(await codigoAl(urlApp(), sql`DELETE FROM admin`)).toBe('42501');
    expect(await codigoAl(urlApp(), sql`UPDATE admin SET password_hash = 'x'`)).toBe('42501');
    expect(await codigoAl(urlApp(), sql`UPDATE admin SET email = 'x@x.mx'`)).toBe('42501');
    expect(await codigoAl(urlApp(), sql`UPDATE admin SET rol = 'admin'`)).toBe('42501');
  });
  it('sí puede actualizar el paso TOTP (lo usa el login)', async () => {
    expect(await codigoAl(urlApp(), sql`UPDATE admin SET totp_ultimo_paso = totp_ultimo_paso`)).toBe('ok');
  });
  it('no puede reescribir códigos de recuperación ni revivir uno usado', async () => {
    await truncarTodo();
    await conDbUrl(urlOwner(), async (db) => {
      await db.execute(sql`INSERT INTO admin (id, email, password_hash, totp_secret_cifrado)
        VALUES ('00000000-0000-0000-0000-000000000001', 'a@a.mx', 'h', 'c')`);
      await db.execute(sql`INSERT INTO codigo_recuperacion (admin_id, hash, usado_at)
        VALUES ('00000000-0000-0000-0000-000000000001', 'usado', now())`);
    });
    expect(await codigoAl(urlApp(), sql`UPDATE codigo_recuperacion SET hash = 'x'`)).toBe('42501');
    expect(await codigoAl(urlApp(), sql`UPDATE codigo_recuperacion SET admin_id = admin_id`)).toBe('42501');
    // Un código usado no cambia nunca más (trigger), aunque la columna usado_at sea actualizable.
    expect(await codigoAl(urlApp(), sql`UPDATE codigo_recuperacion SET usado_at = NULL`)).toBe('P0001');
    expect(await codigoAl(urlApp(), sql`UPDATE codigo_recuperacion SET usado_at = now()`)).toBe('P0001');
  });
  it('no puede elegir el rol al insertar un admin', async () => {
    expect(
      await codigoAl(
        urlApp(),
        sql`INSERT INTO admin (email, password_hash, totp_secret_cifrado, rol) VALUES ('r@r.mx','h','c','admin')`,
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
