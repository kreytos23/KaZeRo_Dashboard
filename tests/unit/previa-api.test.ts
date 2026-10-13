import { beforeEach, describe, expect, it, vi } from 'vitest';

const U = '0b0e4c43-4a6b-4a1f-9a5e-2f9d8d1e7c11';
const sesion = vi.fn();
const previsualizar = vi.fn();
vi.mock('@/server/auth/sesion-actual', () => ({ sesionDeApi: () => sesion() }));
vi.mock('@/db/client', () => ({ conDbLectura: (fn: (db: unknown) => unknown) => fn({}) }));
vi.mock('@/server/pedidos/lecturas', () => ({
  previsualizarPedido: (...a: unknown[]) => previsualizar(...a),
}));

const { GET } = await import('@/app/api/pedidos/previa/route');
const pedir = (qs: string) => GET(new Request(`http://localhost/api/pedidos/previa${qs}`));

beforeEach(() => {
  sesion.mockResolvedValue({ adminId: 'a' });
  previsualizar.mockReset();
  previsualizar.mockResolvedValue({ piezas: [], faltantes: [], cliente: null, tarjeta: null });
});

describe('GET /api/pedidos/previa', () => {
  it('sin sesión: 401 JSON y no consulta', async () => {
    sesion.mockResolvedValue(null);
    const r = await pedir('?tarjeta=1');
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'no_autenticado' });
    expect(previsualizar).not.toHaveBeenCalled();
  });
  it('consulta inválida: 400 JSON y no consulta', async () => {
    for (const qs of ['?cliente=no-uuid', `?codigos=${'A,'.repeat(101)}`]) {
      const r = await pedir(qs);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: 'consulta_invalida' });
    }
    expect(previsualizar).not.toHaveBeenCalled();
  });
  it('válida: 200 sin caché con la vista previa', async () => {
    const r = await pedir(`?cliente=${U}&codigos=AF12,AF13&tarjeta=1`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(await r.json()).toEqual({ piezas: [], faltantes: [], cliente: null, tarjeta: null });
    expect(previsualizar).toHaveBeenCalledWith(
      {},
      { clienteId: U, codigos: ['AF12', 'AF13'], cuentaTarjeta: true },
    );
  });
  it('si la base falla: 500 JSON sin caché y sin filtrar el mensaje', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    previsualizar.mockRejectedValue(new Error('conexión a postgres://secreto falló'));
    const r = await pedir(`?cliente=${U}&tarjeta=1`);
    expect(r.status).toBe(500);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(await r.json()).toEqual({ error: 'error_interno' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secreto');
    log.mockRestore();
  });
});
