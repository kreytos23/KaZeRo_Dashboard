import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { accesoLog, admin, sesion } from '@/db/schema';
import { codigoRecuperacion } from '@/db/schema';
import { crearAdmin } from '@/server/auth/admin';
import {
  agregarAdmin,
  guardarNombreAdmin,
  listarAdmins,
  nombreDeAdmin,
  regenerarTotp,
} from '@/server/auth/administradores';
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
// Para las altas que no llegan al bloqueo: la sesión actual no interviene.
const SIN_SESION = '00000000-0000-4000-8000-000000000000';

let adminId: string;
let secreto: string;
let codigosViejos: string[];

beforeEach(async () => {
  await truncarTodo();
  const a = await conDbUrl(urlOwner(), (db) =>
    crearAdmin(db, { email: 'duena@kazero.mx', password: PASS }, llaveTotp()),
  );
  adminId = a.id;
  secreto = a.secretoTotp;
  codigosViejos = a.codigosRecuperacion;
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

async function loginConCodigo(email: string, password: string, codigo: string, t: Date) {
  const pre = await app((db) => iniciarLogin(db, { email, password, ...red }, t));
  if (!pre.ok) return pre;
  return app((db) => verificarSegundoFactor(db, { preToken: pre.preToken, codigo, ...red }, llaveTotp(), t));
}

/**
 * Inicia sesión de verdad (fila en `sesion`) y devuelve su token e id. El login_ok queda 1 s antes de `t`
 * para no empatar con los fallos que las pruebas registran en `t`.
 */
async function sesionReal(t: Date) {
  const s = await login('duena@kazero.mx', PASS, secreto, new Date(t.getTime() - 1000));
  if (!s.ok) throw new Error('login falló');
  const v = await app((db) => validarSesion(db, s.token, t));
  if (!v) throw new Error('sesión inválida');
  return { token: s.token, sesionId: v.sesionId };
}

const revocadaAt = (id: string) =>
  conDbUrl(urlOwner(), (db) =>
    db.select({ r: sesion.revocadaAt }).from(sesion).where(eq(sesion.id, id)),
  ).then((f) => f[0]!.r);

const eventos = (email: string) =>
  app((db) => db.select({ evento: accesoLog.evento }).from(accesoLog).where(eq(accesoLog.email, email))).then(
    (f) => f.map((x) => x.evento),
  );

describe('nombre del administrador', () => {
  it('kazero_app lo guarda, lo quita con vacío y el CHECK valida el largo', async () => {
    expect(await app((db) => nombreDeAdmin(db, adminId))).toBeNull();
    await app((db) => guardarNombreAdmin(db, adminId, '  Kazero  '));
    expect(await app((db) => nombreDeAdmin(db, adminId))).toBe('Kazero');
    expect((await app((db) => listarAdmins(db)))[0]!.nombre).toBe('Kazero');
    await expect(app((db) => guardarNombreAdmin(db, adminId, 'x'.repeat(61)))).rejects.toThrow(/60/);
    await app((db) => guardarNombreAdmin(db, adminId, '   '));
    expect(await app((db) => nombreDeAdmin(db, adminId))).toBeNull();
  });
  it('se puede dar al agregar un administrador', async () => {
    const r = await app((db) =>
      agregarAdmin(
        db,
        {
          adminActualId: adminId,
          sesionActualId: SIN_SESION,
          passwordActual: PASS,
          email: 'otra@kazero.mx',
          nombre: 'Otra',
          password: 'una-contraseña-larga-123',
          confirmacion: 'una-contraseña-larga-123',
          ...red,
        },
        llaveTotp(),
      ),
    );
    expect(r.ok).toBe(true);
    const f = await app((db) => listarAdmins(db));
    expect(f.find((a) => a.email === 'otra@kazero.mx')?.nombre).toBe('Otra');
  });
});

describe('agregar administrador', () => {
  it('exige la contraseña actual y registra el fallo (cuenta para el bloqueo)', async () => {
    const r = await app((db) =>
      agregarAdmin(
        db,
        {
          adminActualId: adminId,
          sesionActualId: SIN_SESION,
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
          sesionActualId: SIN_SESION,
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
      sesionActualId: SIN_SESION,
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
    // Los códigos de recuperación anteriores ya no sirven; los nuevos sí.
    const t2 = new Date('2026-10-09T13:00:00Z');
    expect(await loginConCodigo('duena@kazero.mx', PASS, codigosViejos[0]!, t2)).toEqual({
      ok: false,
      motivo: 'codigo',
    });
    expect(
      (
        await loginConCodigo(
          'duena@kazero.mx',
          PASS,
          r.codigosRecuperacion[0]!,
          new Date('2026-10-09T13:20:00Z'),
        )
      ).ok,
    ).toBe(true);
  });

  it('con la contraseña incorrecta no cambia nada', async () => {
    const t0 = new Date('2026-10-09T12:00:00Z');
    const s = await login('duena@kazero.mx', PASS, secreto, t0);
    if (!s.ok) throw new Error('login falló');
    const ses = (await app((db) => validarSesion(db, s.token, t0)))!;
    const antes = await app((db) => db.select({ c: admin.totpSecretCifrado, v: admin.version }).from(admin));
    const r = await app((db) =>
      regenerarTotp(
        db,
        { adminId, sesionActualId: ses.sesionId, passwordActual: 'mala-mala-mala', ...red },
        llaveTotp(),
        t0,
      ),
    );
    expect(r).toEqual({ ok: false, error: 'Tu contraseña actual no es correcta.' });
    expect(
      await app((db) => db.select({ c: admin.totpSecretCifrado, v: admin.version }).from(admin)),
    ).toEqual(antes);
    const usados = await app((db) => db.select({ u: codigoRecuperacion.usadoAt }).from(codigoRecuperacion));
    expect(usados.every((f) => f.u === null)).toBe(true);
    expect(await eventos('duena@kazero.mx')).toContain('password_fallido');
  });

  it('la re-autenticación cuenta para el bloqueo por intentos y al bloquearse revoca la sesión actual', async () => {
    const t0 = new Date('2026-10-09T12:00:00Z');
    const { token, sesionId } = await sesionReal(t0);
    const intento = (passwordActual: string) =>
      app((db) =>
        regenerarTotp(db, { adminId, sesionActualId: sesionId, passwordActual, ...red }, llaveTotp(), t0),
      );
    for (let i = 0; i < 4; i++) expect(await intento('mala-mala-mala')).toMatchObject({ ok: false });
    expect(await revocadaAt(sesionId)).toBeNull(); // aún no hay bloqueo: la sesión sigue viva
    expect(await intento('mala-mala-mala')).toMatchObject({ ok: false });
    const r = await intento(PASS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Demasiados intentos');
    // La interfaz usa este indicador para llevar al login con el motivo (sin PII) cuando se revoca la sesión.
    expect(r).toMatchObject({ bloqueado: true });
    expect(await revocadaAt(sesionId)).toEqual(t0);
    expect(await app((db) => validarSesion(db, token, t0))).toBeNull();
  });
});

describe('bloqueo al agregar administrador', () => {
  it('al bloquearse la re-autenticación revoca la sesión actual y devuelve bloqueado', async () => {
    const t0 = new Date('2026-10-09T12:00:00Z');
    const { token, sesionId } = await sesionReal(t0);
    const intento = (passwordActual: string) =>
      app((db) =>
        agregarAdmin(
          db,
          {
            adminActualId: adminId,
            sesionActualId: sesionId,
            passwordActual,
            email: 'cliente@kazero.mx',
            password: 'otra-contraseña-123',
            confirmacion: 'otra-contraseña-123',
            ...red,
          },
          llaveTotp(),
          t0,
        ),
      );
    for (let i = 0; i < 5; i++) expect(await intento('mala-mala-mala')).toMatchObject({ ok: false });
    const r = await intento(PASS);
    expect(r).toMatchObject({ ok: false, bloqueado: true });
    if (!r.ok) expect(r.error).toContain('Demasiados intentos');
    expect(await revocadaAt(sesionId)).toEqual(t0);
    expect(await app((db) => validarSesion(db, token, t0))).toBeNull();
    expect(await app((db) => listarAdmins(db))).toHaveLength(1);
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
