import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { nombreMes } from '../../src/domain/comisiones';
import { hoyMX } from '../../src/domain/fechas';
import {
  abrirAccion,
  elegirOpcion,
  irA,
  RUTA_ESTADO,
  sembrarCliente,
  sembrarPedidoConAbonos,
  sembrarVendedora,
} from './utilidades';

// Reportes del Plan 5a: deudores, comisiones (cierre de mes, pago y anulación) y resumen en la ficha de la vendedora.
test.use({ storageState: RUTA_ESTADO });

const marca = (proyecto: string) => (proyecto === 'movil' ? 'M' : 'E');
const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const tarjeta = (page: Page, nombre: string): Locator => page.locator('details', { hasText: nombre });

/** Día 10 del mes anterior a hoy: un mes ya terminado, así que cerrable. */
function mesPasado() {
  const [a, m] = hoyMX().split('-').map(Number) as [number, number];
  const fecha = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
  return { mes: fecha, dia: `${fecha}-10`, nombre: nombreMes(`${fecha}-01`) };
}

/** Pulsa «Descargar PDF», espera la descarga y devuelve el nombre y los primeros bytes del archivo. */
async function descargarPdf(page: Page, enlace: Locator) {
  const [descarga] = await Promise.all([page.waitForEvent('download'), enlace.click()]);
  const bytes = readFileSync((await descarga.path())!);
  return { nombre: descarga.suggestedFilename(), cabecera: bytes.subarray(0, 5).toString('latin1') };
}

test.describe('reportes', () => {
  // La vendedora, la clienta y los pedidos sembrados en la primera prueba los usan las siguientes.
  test.describe.configure({ mode: 'serial' });

  let vendedora = '';
  let vendedoraId = '';
  let otra = '';

  test('deudores: el pedido con abono aparece con su saldo, se filtra por vendedora y se descarga el PDF', async ({
    page,
  }, info) => {
    const m = marca(info.project.name);
    const sufijo = `${m}${info.retry ? ` r${info.retry}` : ''}`;
    vendedora = `Vendedora Rep ${sufijo}`;
    otra = `Otra Rep ${sufijo}`;
    vendedoraId = await sembrarVendedora(vendedora);
    const otraId = await sembrarVendedora(otra);
    const clienta = await sembrarCliente(`Clienta Rep ${sufijo}`);
    const clientaOtra = await sembrarCliente(`Clienta Otra ${sufijo}`);
    const hoy = hoyMX();
    // $149 con abono de $50: debe $99.
    await sembrarPedidoConAbonos(clienta, vendedoraId, `R${m}D1`, hoy, [{ fecha: hoy, centavos: 5000 }]);
    await sembrarPedidoConAbonos(clientaOtra, otraId, `R${m}D2`, hoy, []);

    await irA(page, '/panel/reportes/deudores');
    await expect(tarjeta(page, vendedora)).toContainText(`Clienta Rep ${sufijo}`);
    await expect(tarjeta(page, vendedora)).toContainText('$99.00');
    await expect(tarjeta(page, otra)).toBeVisible();

    await elegirOpcion(page, 'Vendedora', vendedora, true);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/vendedor=/);
    await expect(page.getByText(`Clienta Rep ${sufijo}`)).toBeVisible();
    await expect(page.getByText(`Clienta Otra ${sufijo}`)).toHaveCount(0);
    await expect(page.getByText('Por cobrar: $99.00', { exact: true })).toBeVisible();

    const pdf = await descargarPdf(page, page.getByRole('link', { name: 'Descargar PDF' }));
    expect(pdf.nombre).toBe(`deudores-${hoy}-${slug(vendedora)}.pdf`);
    expect(pdf.cabecera).toBe('%PDF-');
  });

  test('comisiones: estimado → cerrar mes → pago pendiente → pagado → deshacer pago → PDF', async ({
    page,
  }, info) => {
    const m = marca(info.project.name);
    const sufijo = `${m}${info.retry ? ` r${info.retry}` : ''}`;
    const { mes, dia, nombre } = mesPasado();
    const clienta = await sembrarCliente(`Clienta Com ${sufijo}`);
    // Liquidado el día 10 del mes pasado: $149 al 10 % = $14.90.
    await sembrarPedidoConAbonos(clienta, vendedoraId, `R${m}C1`, dia, [{ fecha: dia, centavos: 14900 }]);

    // El mes abierto por defecto es el pasado, y ya se puede cerrar.
    await irA(page, '/panel/reportes/comisiones');
    await expect(page.getByRole('heading', { name: new RegExp(`^${nombre}:`) })).toBeVisible();
    const card = tarjeta(page, vendedora);
    await expect(card).toContainText('$14.90');
    await expect(card).toContainText('Estimado');

    await page.getByRole('checkbox', { name: /Confirmo cerrar/ }).check();
    await page.getByRole('button', { name: `Cerrar ${nombre}` }).click();
    // Al cerrar, el mes abierto pasa al siguiente y el formulario (con su aviso) desaparece.
    await expect(page.getByRole('checkbox', { name: /Confirmo cerrar/ })).toHaveCount(0);

    await irA(page, `/panel/reportes/comisiones?mes=${mes}`);
    await expect(tarjeta(page, vendedora)).toContainText('Pago pendiente');

    await page.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(tarjeta(page, vendedora)).toContainText('Pagado');

    await abrirAccion(page, 'Deshacer pago');
    const panel = page.getByRole('region', { name: 'Deshacer pago', exact: true });
    await panel.getByLabel('Motivo').fill('Prueba E2E: pago duplicado');
    await panel.getByRole('button', { name: 'Deshacer pago' }).click();
    await expect(tarjeta(page, vendedora)).toContainText('Pago pendiente');

    const pdf = await descargarPdf(page, page.getByRole('link', { name: 'Descargar PDF', exact: true }));
    expect(pdf.nombre).toBe(`comisiones-${mes}.pdf`);
    expect(pdf.cabecera).toBe('%PDF-');
  });

  test('ficha de la vendedora: por cobrar y el mes con pago pendiente, con enlaces a los reportes', async ({
    page,
  }) => {
    const { mes, nombre } = mesPasado();
    await irA(page, `/panel/vendedores/${vendedoraId}`);
    const bloque = page.getByRole('region', { name: 'Cobranza y comisiones' });
    const cobrar = bloque.getByRole('link', { name: /^Por cobrar: \$99\.00 en 1 pedido$/ });
    await expect(cobrar).toBeVisible();
    await expect(bloque.getByText('Pagos de comisión pendientes')).toBeVisible();
    const pendiente = bloque.getByRole('link', { name: `${nombre}: $14.90` });
    await expect(pendiente).toHaveAttribute('href', new RegExp(`mes=${mes}&vendedor=${vendedoraId}`));

    await cobrar.click();
    await expect(page).toHaveURL(new RegExp(`/panel/reportes/deudores\\?vendedor=${vendedoraId}`));
  });
});
