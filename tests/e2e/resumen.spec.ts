import { expect, test } from '@playwright/test';
import { irA, RUTA_ESTADO } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

test('Reportes abre el Resumen y un rango inválido avisa', async ({ page }) => {
  await irA(page, '/panel/reportes');
  await expect(page).toHaveURL(/\/panel\/reportes\/resumen/);
  await expect(page.getByRole('heading', { name: 'Ventas', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top asociados' })).toBeVisible();
  await irA(page, '/panel/reportes/resumen?periodo=rango&desde=2026-02-30&hasta=2026-03-01');
  await expect(page.getByText('Ese rango no es válido')).toBeVisible();
});

test.describe('sin sesión', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('el Resumen sin sesión manda a iniciar sesión', { tag: '@escritorio' }, async ({ page }) => {
    await page.goto('/panel/reportes/resumen');
    await expect(page).toHaveURL(/\/login$/);
  });
});
