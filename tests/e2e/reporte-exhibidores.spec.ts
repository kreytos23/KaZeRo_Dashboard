import { expect, test } from '@playwright/test';
import { hoyMX } from '../../src/domain/fechas';
import { irA, marcaDe, RUTA_ESTADO, sembrarExhibidorConPieza } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

test('la hoja del mes en curso se ve y se descarga', async ({ page }, info) => {
  const m = marcaDe(info);
  const codigo = `RE${m}1`;
  await sembrarExhibidorConPieza(m, codigo);
  const mes = hoyMX().slice(0, 7);
  await irA(page, `/panel/reportes/exhibidores?mes=${mes}`);
  // La hoja se acota por su `article`; el código se busca exacto para no contar el nombre ni la vendedora.
  const hoja = page.locator('article', { hasText: `Exh ${m} ${codigo}` });
  await expect(hoja.getByText(codigo, { exact: true })).toBeVisible();
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Descargar PDF' }).click(),
  ]);
  expect(descarga.suggestedFilename()).toBe(`exhibidores-${mes}.pdf`);
});
