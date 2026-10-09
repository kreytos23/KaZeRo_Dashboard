import { describe, expect, it, vi } from 'vitest';

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync }));

const CADENA = 'postgresql://neondb_owner:contraseña-secreta@ep-ejemplo.neon.tech/neondb';

describe('neon() (CLI)', () => {
  it('si el CLI falla, el error no arrastra stdout, stderr ni cause (pueden traer credenciales)', async () => {
    execFileSync.mockImplementation(() => {
      throw Object.assign(new Error(`Command failed: pnpm exec neon connection-string\n${CADENA}`), {
        status: 1,
        stdout: CADENA,
        stderr: CADENA,
      });
    });
    const { cadenaConexion } = await import('../../scripts/lib/neon');
    let error: unknown;
    try {
      cadenaConexion('development');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const e = error as Error & Record<string, unknown>;
    expect(e.message).toBe('neon connection-string development falló (status 1)');
    expect(e.cause).toBeUndefined();
    expect(e.stdout).toBeUndefined();
    expect(e.stderr).toBeUndefined();
    expect(JSON.stringify(e) + String(e.stack)).not.toContain('contraseña-secreta');
  });
});
