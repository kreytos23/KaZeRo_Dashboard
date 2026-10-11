import { afterEach, describe, expect, it, vi } from 'vitest';

const { pools } = vi.hoisted(() => ({
  pools: [] as { oyentes: Map<string, (e: unknown) => void>; end: ReturnType<typeof vi.fn> }[],
}));

vi.mock('@neondatabase/serverless', () => ({
  Pool: class {
    oyentes = new Map<string, (e: unknown) => void>();
    end = vi.fn(async () => {});
    constructor() {
      pools.push(this);
    }
    on(evento: string, fn: (e: unknown) => void) {
      this.oyentes.set(evento, fn);
      return this;
    }
  },
}));
vi.mock('drizzle-orm/neon-serverless', () => ({ drizzle: vi.fn(() => ({})) }));

const SECRETO = 'postgresql://kazero_app:contraseña-secreta@ep-ejemplo.neon.tech/neondb';

describe('conDbUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pools.length = 0;
  });

  it('registra un oyente de "error" (un cliente inactivo caído no tumba el proceso) que loguea solo el código', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { conDbUrl } = await import('@/db/pool');
    await conDbUrl(SECRETO, async () => 1);
    const oyente = pools[0]!.oyentes.get('error');
    expect(oyente).toBeTypeOf('function');
    oyente!(Object.assign(new Error(`terminating connection ${SECRETO}`), { code: '57P01' }));
    oyente!(new Error(`socket ${SECRETO}`));
    const salida = JSON.stringify(log.mock.calls);
    expect(salida).toContain('57P01');
    expect(salida).not.toMatch(/contraseña|neon\.tech|terminating/);
  });

  it('cierra el pool aunque la función falle', async () => {
    const { conDbUrl } = await import('@/db/pool');
    await expect(
      conDbUrl(SECRETO, async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(pools[0]!.end).toHaveBeenCalledOnce();
  });
});
