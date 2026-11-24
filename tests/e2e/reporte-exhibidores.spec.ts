import { expect, test } from '@playwright/test';
import { mesDe, mesSiguiente } from '../../src/domain/comisiones';
import { hoyMX } from '../../src/domain/fechas';
import { irA, marcaDe, RUTA_ESTADO, sembrarExhibidorConPieza } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

test('la relación de ventas del mes en curso se ve, se le añaden las ventas y se descarga', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const codigo = `RE${m}1`;
  await sembrarExhibidorConPieza(m, codigo);
  const mes = hoyMX().slice(0, 7);
  await irA(page, `/panel/reportes/exhibidores?mes=${mes}`);
  await expect(page.getByText(/^Mes en curso: al \d{1,2} de [a-z]+ de \d{4}$/)).toBeVisible();
  // La hoja se acota por su `article`; el código se busca exacto para no contar el nombre ni el asociado.
  const hoja = page.locator('article', { hasText: `Exh ${m} ${codigo}` });
  const fila = hoja.getByRole('row', { name: new RegExp(`^${codigo} `) });
  await expect(fila.getByRole('cell', { name: codigo, exact: true })).toBeVisible();
  await expect(fila.getByRole('cell', { name: '$149.00', exact: true })).toBeVisible();
  await expect(hoja.getByText(/^Fecha de entrega: \d{1,2} de [a-z]+ de \d{4}$/)).toBeVisible();
  // Sin cuadres: ni piezas al inicio ni dinero en la hoja.
  await expect(hoja.getByText('Al inicio', { exact: true })).toHaveCount(0);
  await expect(hoja.getByText('Por entregar al cierre', { exact: true })).toHaveCount(0);

  // «Ventas del mes» va apagada por omisión; la casilla la enciende y el PDF hereda el parámetro.
  const ventas = hoja.getByRole('heading', { name: 'Ventas del mes' });
  await expect(ventas).toHaveCount(0);
  const descargar = page.getByRole('link', { name: 'Descargar PDF' });
  await expect(descargar).not.toHaveAttribute('href', /ventas=/);
  // Se aplica sola al marcarla: «Ver» solo existe sin JavaScript.
  await expect(page.getByRole('button', { name: 'Ver', exact: true })).toHaveCount(0);
  await page.getByLabel('Incluir ventas del mes').check();
  await expect(page).toHaveURL(/ventas=1/);
  await expect(ventas).toBeVisible();
  await expect(page.getByLabel('Incluir ventas del mes')).toBeChecked();
  await expect(descargar).toHaveAttribute('href', /ventas=1/);

  const [descarga] = await Promise.all([page.waitForEvent('download'), descargar.click()]);
  expect(descarga.suggestedFilename()).toBe(`exhibidores-${mes}.pdf`);
});

test('sin parámetros se ve la hoja del mes en curso, sin pulsar nada', async ({ page }, info) => {
  const m = marcaDe(info);
  const codigo = `RD${m}1`;
  await sembrarExhibidorConPieza(m, codigo);
  await irA(page, '/panel/reportes/exhibidores');
  await expect(page.getByText(/^Mes en curso: al \d{1,2} de [a-z]+ de \d{4}$/)).toBeVisible();
  const hoja = page.locator('article', { hasText: `Exh ${m} ${codigo}` });
  await expect(hoja.getByRole('cell', { name: codigo, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Descargar PDF' })).toHaveAttribute(
    'href',
    new RegExp(`mes=${hoyMX().slice(0, 7)}`),
  );
});

test('marcar «Incluir ventas del mes» muestra las ventas sin pulsar «Ver»', async ({ page }, info) => {
  const m = marcaDe(info);
  const codigo = `RV${m}1`;
  await sembrarExhibidorConPieza(m, codigo);
  await irA(page, '/panel/reportes/exhibidores');
  const hoja = page.locator('article', { hasText: `Exh ${m} ${codigo}` });
  const ventas = hoja.getByRole('heading', { name: 'Ventas del mes' });
  await expect(hoja.getByRole('cell', { name: codigo, exact: true })).toBeVisible();
  await expect(ventas).toHaveCount(0);
  await page.getByLabel('Incluir ventas del mes').check();
  await expect(page).toHaveURL(/[?&]ventas=1(&|$)/);
  await expect(ventas).toBeVisible();
  await page.getByLabel('Incluir ventas del mes').uncheck();
  await expect(page).not.toHaveURL(/ventas=/);
  await expect(ventas).toHaveCount(0);
});

test('un exhibidor con piezas y sin movimiento en el mes también tiene hoja', async ({ page }, info) => {
  const m = marcaDe(info);
  const codigo = `RF${m}1`;
  await sembrarExhibidorConPieza(m, codigo);
  // El mes siguiente no tiene movimientos: la pieza sigue en el exhibidor y la hoja sale igual.
  const siguiente = mesSiguiente(mesDe(hoyMX())).slice(0, 7);
  await irA(page, `/panel/reportes/exhibidores?mes=${siguiente}`);
  const hoja = page.locator('article', { hasText: `Exh ${m} ${codigo}` });
  await expect(hoja.getByRole('cell', { name: codigo, exact: true })).toBeVisible();
});
