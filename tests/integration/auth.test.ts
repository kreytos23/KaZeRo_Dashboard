import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { crearAdmin } from '@/server/auth/admin';
import {
  POLITICA,
  cerrarSesion,
  cerrarTodas,
  iniciarLogin,
  validarSesion,
  verificarSegundoFactor,
} from '@/server/auth/servicio';
import { generarCodigoTotp, pasoTotpValido } from '@/server/auth/totp';
import { llaveTotp, truncarAuth, urlApp, urlOwner } from './utilidades';

const EMAIL = 'dueña@kazero.mx';
const PASSWORD = 'contraseña-de-prueba-123';
const red = { ip: '203.0.113.7', userAgent: 'vitest' };
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const min = (n: number) => n * 60_000;

let secreto: string;
let codigos: string[];
let adminId: string;

beforeEach(async () => {
  await truncarAuth();
  const a = await conDbUrl(urlOwner(), (db) =>
    crearAdmin(db, { email: EMAIL, password: PASSWORD }, llaveTotp()),
  );
  secreto = a.secretoTotp;
  codigos = a.codigosRecuperacion;
  adminId = a.id;
});

async function loginCompleto(t: Date) {
  const pre = await app((db) => iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, t));
  if (!pre.ok) throw new Error('login falló');
  return app((db) =>
    verificarSegundoFactor(
      db,
      { preToken: pre.preToken, codigo: generarCodigoTotp(secreto, t), ...red },
      llaveTotp(),
      t,
    ),
  );
}

describe('login en dos pasos', () => {
  it('contraseña correcta + TOTP → sesión válida; el pre-token deja de servir', async () => {
    const t = new Date('2026-10-08T12:00:00Z');
    const pre = await app((db) =>
      iniciarLogin(db, { email: 'DUEÑA@kazero.mx ', password: PASSWORD, ...red }, t),
    );
    expect(pre.ok).toBe(true);
    if (!pre.ok) return;
    const fin = await app((db) =>
      verificarSegundoFactor(
        db,
        { preToken: pre.preToken, codigo: generarCodigoTotp(secreto, t), ...red },
        llaveTotp(),
        t,
      ),
    );
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(await app((db) => validarSesion(db, fin.token, t))).toEqual({
      adminId,
      sesionId: expect.any(String),
    });
    // El pre-token ya se consumió: ni con otro factor válido sirve de nuevo.
    expect(
      await app((db) =>
        verificarSegundoFactor(db, { preToken: pre.preToken, codigo: codigos[1]!, ...red }, llaveTotp(), t),
      ),
    ).toEqual({ ok: false, motivo: 'sesion' });
  });

  it('contraseña incorrecta y correo inexistente dan el mismo motivo', async () => {
    const t = new Date();
    const a = await app((db) => iniciarLogin(db, { email: EMAIL, password: 'mala-mala-mala', ...red }, t));
    const b = await app((db) => iniciarLogin(db, { email: 'nadie@x.mx', password: PASSWORD, ...red }, t));
    expect(a).toEqual({ ok: false, motivo: 'credenciales' });
    expect(b).toEqual({ ok: false, motivo: 'credenciales' });
  });

  it(`bloquea tras ${POLITICA.maxFallos} fallos en ${POLITICA.ventanaMin} min y libera después`, async () => {
    const t0 = new Date('2026-10-08T12:00:00Z');
    for (let i = 0; i < POLITICA.maxFallos; i++) {
      await app((db) =>
        iniciarLogin(
          db,
          { email: EMAIL, password: 'mala-mala-mala', ...red },
          new Date(t0.getTime() + i * 1000),
        ),
      );
    }
    const bloqueado = await app((db) =>
      iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, new Date(t0.getTime() + 10_000)),
    );
    expect(bloqueado).toMatchObject({ ok: false, motivo: 'bloqueado' });
    if (!bloqueado.ok) expect(bloqueado.minutosRestantes).toBeGreaterThanOrEqual(14);
    const despues = await app((db) =>
      iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, new Date(t0.getTime() + min(16))),
    );
    expect(despues.ok).toBe(true);
  });

  it('el mismo código TOTP no se puede usar dos veces', async () => {
    const t = new Date('2026-10-08T12:00:05Z');
    expect((await loginCompleto(t)).ok).toBe(true);
    expect(await loginCompleto(t)).toEqual({ ok: false, motivo: 'codigo' });
  });

  it('un código de recuperación sirve una sola vez', async () => {
    const t = new Date();
    const usar = async () => {
      const pre = await app((db) => iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, t));
      if (!pre.ok) throw new Error('login falló');
      return app((db) =>
        verificarSegundoFactor(db, { preToken: pre.preToken, codigo: codigos[0]!, ...red }, llaveTotp(), t),
      );
    };
    expect((await usar()).ok).toBe(true);
    expect(await usar()).toEqual({ ok: false, motivo: 'codigo' });
  });

  it(`el pre-token caduca a los ${POLITICA.preMfaMin} min`, async () => {
    const t = new Date('2026-10-08T12:00:00Z');
    const pre = await app((db) => iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, t));
    if (!pre.ok) throw new Error('login falló');
    const tarde = new Date(t.getTime() + min(POLITICA.preMfaMin + 1));
    const r = await app((db) =>
      verificarSegundoFactor(
        db,
        { preToken: pre.preToken, codigo: generarCodigoTotp(secreto, tarde), ...red },
        llaveTotp(),
        tarde,
      ),
    );
    expect(r).toEqual({ ok: false, motivo: 'sesion' });
  });
});

/** Un código de 6 dígitos que no es válido en ninguna ventana TOTP aceptada en `t`. */
function codigoMalo(t: Date): string {
  for (let n = 0; ; n++) {
    const c = String(n).padStart(6, '0');
    if (pasoTotpValido(secreto, c, t) === null) return c;
  }
}

describe('bloqueo y concurrencia', () => {
  it('intentos de contraseña en paralelo no se saltan el límite de fallos', async () => {
    const t = new Date('2026-10-08T12:00:00Z');
    const rs = await Promise.all(
      Array.from({ length: 10 }, () =>
        app((db) => iniciarLogin(db, { email: EMAIL, password: 'mala-mala-mala', ...red }, t)),
      ),
    );
    // Cada intento cuenta: solo los primeros maxFallos llegan a verificarse.
    expect(rs.filter((r) => !r.ok && r.motivo === 'credenciales')).toHaveLength(POLITICA.maxFallos);
    expect(rs.filter((r) => !r.ok && r.motivo === 'bloqueado')).toHaveLength(10 - POLITICA.maxFallos);
    const final = await app((db) =>
      iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, new Date(t.getTime() + 1000)),
    );
    expect(final).toMatchObject({ ok: false, motivo: 'bloqueado' });
  });

  it(`${POLITICA.maxFallos} códigos TOTP malos bloquean y revocan el pre-token`, async () => {
    const t = new Date('2026-10-08T12:00:00Z');
    const pre = await app((db) => iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, t));
    if (!pre.ok) throw new Error('login falló');
    for (let i = 0; i < POLITICA.maxFallos; i++) {
      const r = await app((db) =>
        verificarSegundoFactor(db, { preToken: pre.preToken, codigo: codigoMalo(t), ...red }, llaveTotp(), t),
      );
      expect(r).toEqual({ ok: false, motivo: 'codigo' });
    }
    const bloqueado = await app((db) =>
      verificarSegundoFactor(
        db,
        { preToken: pre.preToken, codigo: generarCodigoTotp(secreto, t), ...red },
        llaveTotp(),
        t,
      ),
    );
    expect(bloqueado).toMatchObject({ ok: false, motivo: 'bloqueado' });
    const otraVez = await app((db) =>
      verificarSegundoFactor(db, { preToken: pre.preToken, codigo: codigos[0]!, ...red }, llaveTotp(), t),
    );
    expect(otraVez).toEqual({ ok: false, motivo: 'sesion' });
    expect(
      await app((db) => iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, t)),
    ).toMatchObject({ ok: false, motivo: 'bloqueado' });
  });

  it('un login completo reinicia el contador de fallos', async () => {
    const t0 = new Date('2026-10-08T12:00:00Z');
    const en = (s: number) => new Date(t0.getTime() + s * 1000);
    for (let i = 0; i < POLITICA.maxFallos - 1; i++) {
      await app((db) => iniciarLogin(db, { email: EMAIL, password: 'mala-mala-mala', ...red }, en(i)));
    }
    expect((await loginCompleto(en(10))).ok).toBe(true);
    await app((db) => iniciarLogin(db, { email: EMAIL, password: 'mala-mala-mala', ...red }, en(20)));
    const r = await app((db) => iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, en(30)));
    expect(r.ok).toBe(true);
  });

  it('dos factores válidos en paralelo con el mismo pre-token dan una sola sesión', async () => {
    const t = new Date('2026-10-08T12:00:00Z');
    const pre = await app((db) => iniciarLogin(db, { email: EMAIL, password: PASSWORD, ...red }, t));
    if (!pre.ok) throw new Error('login falló');
    const rs = await Promise.all(
      [generarCodigoTotp(secreto, t), codigos[0]!].map((codigo) =>
        app((db) => verificarSegundoFactor(db, { preToken: pre.preToken, codigo, ...red }, llaveTotp(), t)),
      ),
    );
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });

  it('dos logins completos en paralelo con el mismo paso TOTP dan una sola sesión', async () => {
    const t = new Date('2026-10-08T12:00:05Z');
    const rs = await Promise.all([loginCompleto(t), loginCompleto(t)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('sesiones', () => {
  it(`caducan a los ${POLITICA.sesionDias} días`, async () => {
    const t = new Date('2026-10-08T12:00:00Z');
    const s = await loginCompleto(t);
    if (!s.ok) throw new Error('login falló');
    const tarde = new Date(t.getTime() + (POLITICA.sesionDias * 24 * 60 + 1) * 60_000);
    expect(await app((db) => validarSesion(db, s.token, tarde))).toBeNull();
  });

  it('cerrar sesión invalida ese token', async () => {
    const t = new Date('2026-10-08T12:00:00Z');
    const s = await loginCompleto(t);
    if (!s.ok) throw new Error('login falló');
    await app((db) => cerrarSesion(db, s.token, t));
    expect(await app((db) => validarSesion(db, s.token, t))).toBeNull();
  });

  it('cerrar en todos los dispositivos invalida todas', async () => {
    const a = await loginCompleto(new Date('2026-10-08T12:00:00Z'));
    const b = await loginCompleto(new Date('2026-10-08T12:01:00Z'));
    if (!a.ok || !b.ok) throw new Error('login falló');
    const t = new Date('2026-10-08T12:02:00Z');
    await app((db) => cerrarTodas(db, adminId, t));
    expect(await app((db) => validarSesion(db, a.token, t))).toBeNull();
    expect(await app((db) => validarSesion(db, b.token, t))).toBeNull();
  });
});
