import { afterEach, describe, expect, it, vi } from 'vitest';

const { conDb } = vi.hoisted(() => ({ conDb: vi.fn() }));
vi.mock('@/db/client', () => ({ conDb }));
vi.mock('@/server/env', () => ({ env: vi.fn(() => ({})) }));

const SECRETO = 'postgresql://kazero_app:contraseña-secreta@ep-ejemplo.neon.tech/neondb';

describe('GET /api/health/listo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    conDb.mockReset();
  });

  it('responde ok cuando la BD contesta, sin cache', async () => {
    conDb.mockResolvedValue(undefined);
    const { GET } = await import('@/app/api/health/listo/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', db: 'ok' });
    expect(conDb).toHaveBeenCalledOnce();
  });

  it('si la BD falla responde 503 sin detalles del error (ni en el cuerpo ni en el log)', async () => {
    conDb.mockRejectedValue(new Error(`connect ECONNREFUSED ${SECRETO}`));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('@/app/api/health/listo/route');
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const texto = await res.text();
    expect(JSON.parse(texto)).toEqual({ status: 'error' });
    expect(texto).not.toMatch(/ECONNREFUSED|contraseña|neon\.tech/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/ECONNREFUSED|contraseña|neon\.tech/);
  });
});
