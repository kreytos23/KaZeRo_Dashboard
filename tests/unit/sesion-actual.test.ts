import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React `cache()` solo memoiza dentro de un render de servidor; aquí se emula un único request.
const { memo, conDbLectura, conDb, validarSesion, galleta } = vi.hoisted(() => ({
  memo: new Map<unknown, unknown>(),
  conDbLectura: vi.fn(),
  conDb: vi.fn(),
  validarSesion: vi.fn(),
  galleta: { valor: undefined as string | undefined },
}));

vi.mock('react', () => ({
  cache: <A, R>(fn: (a: A) => R) => {
    return (a: A) => {
      if (!memo.has(a)) memo.set(a, fn(a));
      return memo.get(a) as R;
    };
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (galleta.valor ? { value: galleta.valor } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock('@/db/client', () => ({ conDb, conDbLectura }));
vi.mock('@/server/auth/servicio', () => ({ validarSesion }));

const SESION = { adminId: 'a1', sesionId: 's1' };

describe('requerirSesion', () => {
  beforeEach(() => {
    conDbLectura.mockImplementation(async (fn: (db: unknown) => unknown) => fn({}));
    validarSesion.mockResolvedValue(SESION);
    galleta.valor = 'tok';
  });
  afterEach(() => {
    memo.clear();
    vi.resetAllMocks();
  });

  it('valida la sesión UNA vez por request aunque la llamen layout y página', async () => {
    const { requerirSesion } = await import('@/server/auth/sesion-actual');
    expect(await requerirSesion()).toEqual(SESION);
    expect(await requerirSesion()).toEqual(SESION);
    expect(validarSesion).toHaveBeenCalledOnce();
  });

  it('usa la lectura con reintento (no conDb) para validar', async () => {
    const { requerirSesion } = await import('@/server/auth/sesion-actual');
    await requerirSesion();
    expect(conDbLectura).toHaveBeenCalledOnce();
    expect(conDb).not.toHaveBeenCalled();
  });

  it('sin cookie o con sesión inválida redirige a /login (también en la segunda llamada)', async () => {
    const { requerirSesion } = await import('@/server/auth/sesion-actual');
    galleta.valor = undefined;
    await expect(requerirSesion()).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;/login' });
    galleta.valor = 'malo';
    validarSesion.mockResolvedValue(null);
    await expect(requerirSesion()).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;/login' });
    await expect(requerirSesion()).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;/login' });
  });
});

describe('sesionDeApi', () => {
  afterEach(() => {
    memo.clear();
    vi.resetAllMocks();
  });

  it('devuelve null sin redirigir cuando no hay sesión', async () => {
    conDbLectura.mockImplementation(async (fn: (db: unknown) => unknown) => fn({}));
    validarSesion.mockResolvedValue(null);
    galleta.valor = 'x';
    const { sesionDeApi } = await import('@/server/auth/sesion-actual');
    expect(await sesionDeApi()).toBeNull();
  });
});
