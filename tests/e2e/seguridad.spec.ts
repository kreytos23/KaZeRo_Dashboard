import { expect, test } from '@playwright/test';
import { verificarDespliegue } from '../../scripts/lib/smoke';

test('el smoke test pasa contra el servidor local (y así se prueba el propio smoke)', async ({ baseURL }) => {
  const fallos = await verificarDespliegue(baseURL!, {
    commitEsperado: process.env.KAZERO_COMMIT_SHA ?? 'local',
  });
  expect(fallos).toEqual([]);
});

test('robots.txt niega todo', async ({ request }) => {
  const r = await request.get('/robots.txt');
  expect(await r.text()).toMatch(/Disallow: \//);
});
