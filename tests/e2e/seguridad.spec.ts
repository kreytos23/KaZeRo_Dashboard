import { expect, test } from '@playwright/test';
import { verificarDespliegue } from '../../scripts/lib/smoke';

test(
  'el smoke test pasa contra el servidor local (y así se prueba el propio smoke)',
  { tag: '@escritorio' },
  async ({ baseURL }) => {
    const fallos = await verificarDespliegue(baseURL!, {
      commitEsperado: process.env.KAZERO_COMMIT_SHA ?? 'local',
    });
    expect(fallos).toEqual([]);
  },
);

test('robots.txt niega todo', { tag: '@escritorio' }, async ({ request }) => {
  const r = await request.get('/robots.txt');
  expect(await r.text()).toMatch(/Disallow: \//);
});

test(
  '/api/pedidos/previa sin sesión responde 401 JSON sin caché',
  { tag: '@escritorio' },
  async ({ request }) => {
    const r = await request.get('/api/pedidos/previa?tarjeta=1');
    expect(r.status()).toBe(401);
    expect(r.headers()['content-type']).toMatch(/application\/json/);
    expect(r.headers()['cache-control']).toMatch(/no-store/);
    expect(await r.json()).toEqual({ error: 'no_autenticado' });
  },
);
