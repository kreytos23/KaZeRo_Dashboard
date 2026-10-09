import { afterEach, describe, expect, it, vi } from 'vitest';

const llave = Buffer.alloc(32, 7).toString('base64');

describe('env()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('acepta una configuración válida', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@h.neon.tech/neondb?sslmode=require');
    vi.stubEnv('KAZERO_TOTP_KEY', llave);
    const { env } = await import('@/server/env');
    expect(env().DATABASE_URL).toContain('h.neon.tech');
  });

  it('rechaza una llave TOTP que no mide 32 bytes, nombrando la variable', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@h.neon.tech/neondb');
    vi.stubEnv('KAZERO_TOTP_KEY', Buffer.alloc(16).toString('base64'));
    const { env } = await import('@/server/env');
    expect(() => env()).toThrow(/KAZERO_TOTP_KEY/);
  });

  it('rechaza si falta DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('KAZERO_TOTP_KEY', llave);
    const { env } = await import('@/server/env');
    expect(() => env()).toThrow(/DATABASE_URL/);
  });
});
