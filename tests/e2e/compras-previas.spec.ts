import { expect, test } from '@playwright/test';
import { fechaLarga, hoyMX, sumarMeses } from '../../src/domain/fechas';
import { irA, marcaDe, RUTA_ESTADO, sembrarCliente } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

test('corregir compras previas en la ficha llena los primeros lugares', async ({ page }, info) => {
  const id = await sembrarCliente(`Previas ${marcaDe(info)}`);
  await irA(page, `/panel/clientes/${id}`);
  await page.getByLabel('Compras previas').fill('4');
  await page.getByLabel(/Motivo/).fill('Tarjeta en papel');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados.' })).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Compra 4: compra anterior' })).toBeVisible();
  await expect(page.getByText('4 de 10 · falta 1 para el 10 %')).toBeVisible();
  // L-7: las previas recién registradas cuentan como compra de hoy; la tarjeta vence en 6 meses.
  await expect(page.getByText(`Vence el ${fechaLarga(sumarMeses(hoyMX(), 6))}.`)).toBeVisible();
});
