import { expect, test } from '@playwright/test';
import { finDeMes, mesAnterior, mesDe } from '../../src/domain/comisiones';
import { fechaCorta, hoyMX } from '../../src/domain/fechas';
import { elegirOpcion, irA, RUTA_ESTADO } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

test('Reportes abre el Resumen y un rango inválido avisa', async ({ page }) => {
  await irA(page, '/panel/reportes');
  await expect(page).toHaveURL(/\/panel\/reportes\/resumen/);
  await expect(page.getByRole('heading', { name: 'Ventas', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top asociados' })).toBeVisible();
  // Total del inventario no vendido en pesos (puede ser $0.00 en una base vacía) y su desglose por ubicación.
  const inventario = page.getByRole('region', { name: 'Inventario hoy' });
  // Acotado al párrafo del total: si desaparece, no lo suple el monto de una ubicación.
  const total = inventario.locator('p').filter({ hasText: /· \d+ piezas?$/ });
  await expect(total.getByText(/^\$[\d,]+\.\d{2}$/)).toBeVisible();
  await expect(total.getByText(/^· \d+ piezas?$/)).toBeVisible();
  await expect(inventario.getByRole('heading', { name: 'Piezas por ubicación' })).toBeVisible();
  await irA(page, '/panel/reportes/resumen?periodo=rango&desde=2026-02-30&hasta=2026-03-01');
  await expect(page.getByText('Ese rango no es válido')).toBeVisible();
});

test('el periodo del Resumen se aplica al elegirlo, sin pulsar «Ver»', async ({ page }) => {
  await irA(page, '/panel/reportes/resumen');
  const filtros = page.getByRole('search');
  await expect(filtros.getByRole('button', { name: 'Ver', exact: true })).toHaveCount(0);
  const desde = mesAnterior(mesDe(hoyMX()));
  await elegirOpcion(filtros, 'Periodo', 'Mes anterior', true);
  await expect(page).toHaveURL(/[?&]periodo=anterior(&|$)/);
  await expect(page.getByText(`Del ${fechaCorta(desde)} al ${fechaCorta(finDeMes(desde))}`)).toBeVisible();
});

test.describe('sin sesión', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('el Resumen sin sesión manda a iniciar sesión', { tag: '@escritorio' }, async ({ page }) => {
    await page.goto('/panel/reportes/resumen');
    await expect(page).toHaveURL(/\/login$/);
  });
});
