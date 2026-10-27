import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autorizarCron } from '@/server/seguridad/cron';

// Valor ficticio de prueba: no es el secreto real.
const SECRETO = 'x'.repeat(40);
const req = (auth?: string) =>
  new Request('http://localhost/api/tareas/limpiar-imagenes', {
    headers: auth ? { authorization: auth } : {},
  });

describe('autorizarCron', () => {
  it('solo con "Bearer <secreto>" exacto', () => {
    expect(autorizarCron(req(`Bearer ${SECRETO}`), SECRETO)).toBe(true);
    expect(autorizarCron(req(), SECRETO)).toBe(false);
    expect(autorizarCron(req(`Bearer ${SECRETO}y`), SECRETO)).toBe(false);
    expect(autorizarCron(req(`Bearer ${SECRETO.slice(1)}`), SECRETO)).toBe(false);
    expect(autorizarCron(req(`bearer ${SECRETO}`), SECRETO)).toBe(false);
    expect(autorizarCron(req(SECRETO), SECRETO)).toBe(false);
  });
  it('sin secreto configurado (o muy corto) nadie entra, ni con "Bearer " vacío', () => {
    expect(autorizarCron(req('Bearer '), undefined)).toBe(false);
    expect(autorizarCron(req('Bearer '), '')).toBe(false);
    expect(autorizarCron(req('Bearer undefined'), undefined)).toBe(false);
    expect(autorizarCron(req('Bearer corto'), 'corto')).toBe(false);
  });
  it('lee CRON_SECRET del entorno por defecto; vacío o ausente falla cerrado', () => {
    vi.stubEnv('CRON_SECRET', SECRETO);
    expect(autorizarCron(req(`Bearer ${SECRETO}`))).toBe(true);
    vi.stubEnv('CRON_SECRET', '');
    expect(autorizarCron(req('Bearer '))).toBe(false);
    vi.unstubAllEnvs();
  });
});

const barrer = vi.fn();
vi.mock('@/server/imagenes/barrido', () => ({ barrerImagenesHuerfanas: (o: unknown) => barrer(o) }));
const rotar = vi.fn();
vi.mock('@/server/auth/rotacion', () => ({ rotarAccesoLogCron: () => rotar() }));
vi.mock('@/server/idempotencia', () => ({ limpiarIdempotenciaCron: async () => 0 }));
vi.mock('@/server/imagenes/almacen', () => ({ almacenImagenes: () => ({}) }));
vi.mock('@/db/client', () => ({ conDbLectura: (fn: (db: unknown) => unknown) => fn({}) }));
vi.mock('@/server/piezas/imagen', () => ({ clavesDeImagenReferenciadas: async () => new Set() }));

describe('GET /api/tareas/limpiar-imagenes', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRETO);
    barrer.mockReset().mockResolvedValue({ revisados: 0, borrados: 0 });
    rotar.mockReset().mockResolvedValue(3);
  });
  it('sin cabecera o con un secreto equivocado: 401 JSON, sin barrer', async () => {
    const { GET } = await import('@/app/api/tareas/limpiar-imagenes/route');
    for (const r of [req(), req('Bearer otro-secreto-de-cuarenta-caracteres-xx')]) {
      const res = await GET(r);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'no_autenticado' });
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(barrer).not.toHaveBeenCalled();
  });
  it('CRON_SECRET vacío o ausente: siempre 401, aunque llegue "Bearer " vacío', async () => {
    const { GET } = await import('@/app/api/tareas/limpiar-imagenes/route');
    for (const valor of ['', undefined]) {
      vi.stubEnv('CRON_SECRET', valor);
      for (const r of [req(), req('Bearer '), req('Bearer undefined')])
        expect((await GET(r)).status).toBe(401);
    }
    expect(barrer).not.toHaveBeenCalled();
  });
  it('con el secreto: barre (sin simular) y devuelve solo conteos', async () => {
    const { GET } = await import('@/app/api/tareas/limpiar-imagenes/route');
    const res = await GET(req(`Bearer ${SECRETO}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      revisados: 0,
      borrados: 0,
      idempotenciaBorradas: 0,
      accesoLogBorradas: 3,
    });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(barrer).toHaveBeenCalledTimes(1);
    expect(barrer.mock.calls[0]![0]).not.toHaveProperty('simular', true);
  });
  it('si el barrido falla: 500 JSON genérico, sin filtrar el error', async () => {
    barrer.mockRejectedValue(new Error('token=secreto'));
    const { GET } = await import('@/app/api/tareas/limpiar-imagenes/route');
    const res = await GET(req(`Bearer ${SECRETO}`));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secreto');
  });
  it('si la rotación falla, las otras dos tareas siguen y el JSON lo refleja (sin filtrar el error)', async () => {
    rotar.mockRejectedValue(new Error('token=secreto'));
    const { GET } = await import('@/app/api/tareas/limpiar-imagenes/route');
    const res = await GET(req(`Bearer ${SECRETO}`));
    expect(res.status).toBe(500);
    const txt = await res.text();
    expect(txt).not.toContain('secreto');
    expect(JSON.parse(txt)).toMatchObject({ revisados: 0, idempotenciaBorradas: 0, accesoLogBorradas: null });
  });
  it('si fallan las tres tareas: 500 genérico', async () => {
    barrer.mockRejectedValue(new Error('x'));
    rotar.mockRejectedValue(new Error('y'));
    vi.doMock('@/server/idempotencia', () => ({
      limpiarIdempotenciaCron: async () => {
        throw new Error('z');
      },
    }));
    vi.resetModules();
    const { GET } = await import('@/app/api/tareas/limpiar-imagenes/route');
    const res = await GET(req(`Bearer ${SECRETO}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'barrido_fallido' });
    vi.doUnmock('@/server/idempotencia');
    vi.resetModules();
  });
  it('avisa en el log (sin el valor) cuando CRON_SECRET existe pero es demasiado corto', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    autorizarCron(req('Bearer abc123XYZ'), 'abc123XYZ');
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(aviso.mock.calls)).not.toContain('abc123XYZ');
    aviso.mockClear();
    autorizarCron(req(), undefined);
    autorizarCron(req(`Bearer ${SECRETO}`), SECRETO);
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });
});
