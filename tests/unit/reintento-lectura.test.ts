import { afterEach, describe, expect, it, vi } from 'vitest';
import { esErrorDeConexion, reintentarLectura } from '@/db/reintento';
import { ErrorNegocio } from '@/server/errores';

const SECRETO = 'postgresql://kazero_app:contraseña-secreta@ep-ejemplo.neon.tech/neondb';

describe('esErrorDeConexion', () => {
  it('sí: clase 08 (connection exception) aunque venga envuelto en cause', () => {
    expect(esErrorDeConexion({ code: '08006' })).toBe(true);
    expect(esErrorDeConexion(new Error('Failed query', { cause: { code: '08001' } }))).toBe(true);
  });
  it('sí: 57P01 (admin_shutdown) y 57P03 (cannot_connect_now)', () => {
    expect(esErrorDeConexion({ code: '57P01' })).toBe(true);
    expect(esErrorDeConexion({ code: '57P03' })).toBe(true);
  });
  it('sí: errores de red sin SQLSTATE (socket cerrado, ECONNRESET, evento de WebSocket)', () => {
    expect(esErrorDeConexion(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(esErrorDeConexion(Object.assign(new Error('read'), { code: 'ECONNRESET' }))).toBe(true);
    expect(esErrorDeConexion({ type: 'error', message: 'WebSocket was closed' })).toBe(true);
  });
  it('no: cualquier otro SQLSTATE (restricciones, sintaxis, cancelación por timeout)', () => {
    for (const code of ['23505', '42P01', '57014', '40P01', '22P02', 'XX000']) {
      expect(esErrorDeConexion({ code })).toBe(false);
    }
  });
  it('no: errores de negocio, de programación ni el control de flujo de Next (redirect/notFound)', () => {
    expect(esErrorDeConexion(new ErrorNegocio('x', 'y'))).toBe(false);
    expect(esErrorDeConexion(new TypeError('x is undefined'))).toBe(false);
    expect(esErrorDeConexion(new RangeError('fuera de rango'))).toBe(false);
    expect(esErrorDeConexion(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;…' }))).toBe(
      false,
    );
    expect(esErrorDeConexion(null)).toBe(false);
    expect(esErrorDeConexion('texto')).toBe(false);
  });
});

describe('reintentarLectura', () => {
  afterEach(() => vi.restoreAllMocks());

  const sinEspera = () => ({ dormir: vi.fn(async () => {}), esperaMs: 200 });

  it('sin error: una sola llamada y sin espera', async () => {
    const o = sinEspera();
    const fn = vi.fn(async () => 'ok');
    expect(await reintentarLectura(fn, o)).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
    expect(o.dormir).not.toHaveBeenCalled();
  });

  it('error de conexión: espera y reintenta UNA vez; loguea solo el código', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const o = sinEspera();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error(`connect ${SECRETO}`), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce('ok');
    expect(await reintentarLectura(fn, o)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(o.dormir).toHaveBeenCalledWith(200);
    expect(JSON.stringify(log.mock.calls)).toContain('ECONNRESET');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/contraseña|neon\.tech/);
  });

  it('si el reintento también falla, propaga el segundo error (no reintenta más)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const segundo = { code: '08006' };
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: '57P01' })
      .mockRejectedValueOnce(segundo);
    await expect(reintentarLectura(fn, sinEspera())).rejects.toBe(segundo);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('error que no es de conexión: no reintenta ni espera', async () => {
    const o = sinEspera();
    const err = { code: '23505' };
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(reintentarLectura(fn, o)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledOnce();
    expect(o.dormir).not.toHaveBeenCalled();
  });

  it('la espera por omisión está entre 150 y 300 ms', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dormir = vi.fn(async () => {});
    const fn = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce({ code: '08006' })
      .mockResolvedValueOnce(1);
    await reintentarLectura(fn, { dormir });
    const ms = (dormir.mock.calls[0] as unknown as [number])[0];
    expect(ms).toBeGreaterThanOrEqual(150);
    expect(ms).toBeLessThanOrEqual(300);
  });
});
