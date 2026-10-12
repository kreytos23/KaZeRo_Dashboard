import { beforeEach, describe, expect, it, vi } from 'vitest';

const PIEZA = '0b6f2c1e-3f4a-4c5d-8e9f-a0b1c2d3e4f5';
const CLAVE = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const sesion = vi.fn();
const clave = vi.fn();
const leer = vi.fn();
vi.mock('@/server/auth/sesion-actual', () => ({ sesionDeApi: () => sesion() }));
vi.mock('@/db/client', () => ({ conDbLectura: (fn: (db: unknown) => unknown) => fn({}) }));
vi.mock('@/server/piezas/imagen', () => ({ claveImagenDePieza: () => clave() }));
vi.mock('@/server/imagenes/almacen', () => ({ almacenImagenes: () => ({ leer }) }));

const { GET } = await import('@/app/api/piezas/[id]/imagen/route');
const pedir = (id: string, qs = `?v=${CLAVE}&t=mini`, h: HeadersInit = {}) =>
  GET(new Request(`http://localhost/api/piezas/${id}/imagen${qs}`, { headers: h }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  sesion.mockResolvedValue({ adminId: 'a' });
  clave.mockResolvedValue(CLAVE);
  leer.mockResolvedValue({ cuerpo: new Blob([Uint8Array.of(1, 2, 3)]).stream(), bytes: 3 });
});

describe('GET /api/piezas/[id]/imagen (D7)', () => {
  it('sin sesión: 401 JSON sin caché, sin tocar la BD', async () => {
    sesion.mockResolvedValue(null);
    const r = await pedir(PIEZA);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'no_autenticado' });
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(clave).not.toHaveBeenCalled();
  });
  it('id no-uuid o variante inventada: 404 sin consultar', async () => {
    clave.mockClear();
    expect((await pedir('../../x')).status).toBe(404);
    expect((await pedir(PIEZA, `?v=${CLAVE}&t=original`)).status).toBe(404);
    expect(clave).not.toHaveBeenCalled();
  });
  it('pieza sin foto: 404 JSON', async () => {
    clave.mockResolvedValue(null);
    const r = await pedir(PIEZA);
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });
  it('versión vieja o ausente: 307 a la vigente, sin caché', async () => {
    const r = await pedir(PIEZA, '?v=otra&t=mini');
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe(`http://localhost/api/piezas/${PIEZA}/imagen?v=${CLAVE}&t=mini`);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });
  it('vigente: WebP con caché privada inmutable y cabeceras de seguridad; lee la ruta que dice la BD', async () => {
    const r = await pedir(PIEZA);
    expect(r.status).toBe(200);
    expect(Object.fromEntries(r.headers)).toMatchObject({
      'content-type': 'image/webp',
      'content-length': '3',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'cross-origin-resource-policy': 'same-origin',
      etag: `"${CLAVE}-mini"`,
    });
    expect(leer).toHaveBeenCalledWith(`piezas/${PIEZA}/${CLAVE}-mini.webp`);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3));
  });
  it('If-None-Match igual: 304 sin leer el almacén', async () => {
    leer.mockClear();
    const r = await pedir(PIEZA, `?v=${CLAVE}&t=mini`, { 'if-none-match': `"${CLAVE}-mini"` });
    expect(r.status).toBe(304);
    expect(leer).not.toHaveBeenCalled();
  });
  it('blob ausente: 404; almacén caído: 503 (sin filtrar el error)', async () => {
    leer.mockResolvedValueOnce(null);
    expect((await pedir(PIEZA)).status).toBe(404);
    leer.mockRejectedValueOnce(new Error('token=secreto'));
    const r = await pedir(PIEZA);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('secreto');
  });
});
