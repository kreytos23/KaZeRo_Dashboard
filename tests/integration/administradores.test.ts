import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { accesoLog } from '@/db/schema';
import { crearAdmin } from '@/server/auth/admin';
import { agregarAdmin, listarAdmins, regenerarTotp } from '@/server/auth/administradores';
import {
  cerrarSesion,
  cerrarTodas,
  iniciarLogin,
  validarSesion,
  verificarSegundoFactor,
} from '@/server/auth/servicio';
import { generarCodigoTotp } from '@/server/auth/totp';
import { llaveTotp, truncarTodo, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const red = { ip: '203.0.113.9', userAgent: 'vitest' };
const PASS = 'contraseña-actual-123';

let adminId: string;
let secreto: string;

beforeEach(async () => {
  await truncarTodo();
  const a = await conDbUrl(urlOwner(), (db) =>
    crearAdmin(db, { email: 'duena@kazero.mx', password: PASS }, llaveTotp()),
  );
  adminId = a.id;
  secreto = a.secretoTotp;
});

async function login(email: string, password: string, sec: string, t: Date) {
  const pre = await app((db) => iniciarLogin(db, { email, password, ...red }, t));
  if (!pre.ok) return pre;
  return app((db) =>
    verificarSegundoFactor(
      db,
      { preToken: pre.preToken, codigo: generarCodigoTotp(sec, t), ...red },
      llaveTotp(),
      t,
    ),
  );
}

const eventos = (email: string) =>
  app((db) => db.select({ evento: accesoLog.evento }).from(accesoLog).where(eq(accesoLog.email, email))).then(
    (f) => f.map((x) => x.evento),
  );

describe('agregar administrador', () => {
  it('exige la contraseña actual y registra el fallo (cuenta para el bloqueo)', async () => {
    const r = await app((db) =>
      agregarAdmin(
        db,
        {
          adminActualId: adminId,
          passwordActual: 'mala-mala-mala',
          email: 'cliente@kazero.mx',
          password: 'otra-contraseña-123',
          confirmacion: 'otra-contraseña-123',
          ...red,
        },
        llaveTotp(),
      ),
    );
    expect(r).toEqual({ ok: false, error: 'Tu contraseña actual no es correcta.' });
    expect(await eventos('duena@kazero.mx')).toContain('password_fallido');
    expect(await app((db) => listarAdmins(db))).toHaveLength(1);
  });

  it('crea una cuenta nueva que puede entrar con su propio TOTP', async () => {
    const r = await app((db) =>
      agregarAdmin(
        db,
        {
          adminActualId: adminId,
          passwordActual: PASS,
          email: ' Cliente@Kazero.mx ',
          password: 'otra-contraseña-123',
          confirmacion: 'otra-contraseña-123',
          ...red,
        },
        llaveTotp(),
      ),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.email).toBe('cliente@kazero.mx');
    expect(r.codigosRecuperacion).toHaveLength(8);
    expect(
      (
        await login(
          'cliente@kazero.mx',
          'otra-contraseña-123',
          r.secretoTotp,
          new Date('2026-10-09T12:00:00Z'),
        )
      ).ok,
    ).toBe(true);
    expect(await eventos('duena@kazero.mx')).toContain('admin_creado');
  });

  it('rechaza correos repetidos y contraseñas débiles', async () => {
    const base = {
      adminActualId: adminId,
      passwordActual: PASS,
      password: 'otra-contraseña-123',
      confirmacion: 'otra-contraseña-123',
      ...red,
    };
    expect(await app((db) => agregarAdmin(db, { ...base, email: 'DUENA@kazero.mx' }, llaveTotp()))).toEqual({
      ok: false,
      error: 'Ya existe un administrador con ese correo.',
    });
    expect(
      await app((db) =>
        agregarAdmin(
          db,
          { ...base, email: 'x@kazero.mx', password: 'corta', confirmacion: 'corta' },
          llaveTotp(),
        ),
      ),
    ).toMatchObject({ ok: false });
  });
});

describe('regenerar TOTP', () => {
  it('invalida el TOTP y los códigos viejos, y cierra las demás sesiones', async () => {
    const t0 = new Date('2026-10-09T12:00:00Z');
    const actual = await login('duena@kazero.mx', PASS, secreto, t0);
    const otra = await login('duena@kazero.mx', PASS, secreto, new Date('2026-10-09T12:01:00Z'));
    if (!actual.ok || !otra.ok) throw new Error('login falló');
    const sesionActual = (await app((db) => validarSesion(db, actual.token, t0)))!;

    const r = await app((db) =>
      regenerarTotp(
        db,
        { adminId, sesionActualId: sesionActual.sesionId, passwordActual: PASS, ...red },
        llaveTotp(),
      ),
    );
    if (!r.ok) throw new Error(r.error);

    const t = new Date('2026-10-09T12:05:00Z');
    expect(await app((db) => validarSesion(db, actual.token, t))).not.toBeNull();
    expect(await app((db) => validarSesion(db, otra.token, t))).toBeNull();
    expect(await login('duena@kazero.mx', PASS, secreto, t)).toEqual({ ok: false, motivo: 'codigo' });
    expect((await login('duena@kazero.mx', PASS, r.secretoTotp, new Date('2026-10-09T12:06:00Z'))).ok).toBe(
      true,
    );
    expect(await eventos('duena@kazero.mx')).toContain('totp_regenerado');
  });
});

describe('eventos de cierre de sesión (spec §7.2)', () => {
  it('registra logout y logout_todos', async () => {
    const t = new Date('2026-10-09T12:00:00Z');
    const s = await login('duena@kazero.mx', PASS, secreto, t);
    if (!s.ok) throw new Error('login falló');
    await app((db) => cerrarSesion(db, s.token, t, red));
    await app((db) => cerrarTodas(db, adminId, t, red));
    const ev = await eventos('duena@kazero.mx');
    expect(ev).toEqual(expect.arrayContaining(['logout', 'logout_todos']));
  });
});
