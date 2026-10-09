import { afterEach, describe, expect, it, vi } from 'vitest';

describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('responde ok con el commit desplegado y sin cache', async () => {
    vi.stubEnv('KAZERO_COMMIT_SHA', 'abc1234');
    const { GET } = await import('@/app/api/health/route');
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', commit: 'abc1234' });
  });

  it('usa "local" si no hay SHA', async () => {
    vi.stubEnv('KAZERO_COMMIT_SHA', '');
    const { GET } = await import('@/app/api/health/route');
    expect(await GET().json()).toEqual({ status: 'ok', commit: 'local' });
  });
});
