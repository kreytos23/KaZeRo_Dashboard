import { afterEach, describe, expect, it, vi } from 'vitest';

type Cliente = { query: ReturnType<typeof vi.fn> };
const { pools, migrate } = vi.hoisted(() => ({
  pools: [] as { opciones: Record<string, unknown>; oyentes: Map<string, (c: unknown) => unknown> }[],
  migrate: vi.fn(async () => {}),
}));

vi.mock('@neondatabase/serverless', () => ({
  Pool: class {
    oyentes = new Map<string, (c: unknown) => unknown>();
    constructor(public opciones: Record<string, unknown>) {
      pools.push(this);
    }
    on(evento: string, fn: (c: unknown) => unknown) {
      this.oyentes.set(evento, fn);
      return this;
    }
    async end() {}
  },
}));
vi.mock('drizzle-orm/neon-serverless', () => ({ drizzle: vi.fn(() => ({})) }));
vi.mock('drizzle-orm/neon-serverless/migrator', () => ({ migrate }));

describe('migrar', () => {
  afterEach(() => {
    pools.length = 0;
    migrate.mockClear();
  });

  it('usa una sola conexión con lock_timeout y statement_timeout: una migración nunca espera para siempre', async () => {
    const { migrar } = await import('../../scripts/lib/migrar');
    await migrar('postgresql://owner:x@ep-ejemplo.neon.tech/neondb');
    const pool = pools[0]!;
    expect(pool.opciones.max).toBe(1);
    const alConectar = pool.oyentes.get('connect');
    expect(alConectar).toBeTypeOf('function');
    const cliente: Cliente = { query: vi.fn(async () => ({})) };
    await alConectar!(cliente);
    const sentencias = cliente.query.mock.calls.map((c) => String(c[0])).join(';');
    expect(sentencias).toMatch(/SET lock_timeout = '5s'/);
    expect(sentencias).toMatch(/SET statement_timeout = '\d+s'/);
    expect(migrate).toHaveBeenCalledOnce();
  });
});
