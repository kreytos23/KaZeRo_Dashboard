import { expect, test, type Page } from '@playwright/test';
import { elegirOpcion, irA, marcaDe, RUTA_ESTADO, sembrarPiezas, sembrarVendedora } from './utilidades';

// Plan 4a: el dinero del exhibidor de punta a punta (venta de mostrador con cobro parcial, abono, entrega y cierre).
test.use({ storageState: RUTA_ESTADO });

const estadoCon = (page: Page, texto: string | RegExp) => page.getByRole('status').filter({ hasText: texto });
const porEntregar = (page: Page) => page.getByRole('region', { name: 'Por entregar', exact: true });
const formulario = (page: Page, nombre: string) => page.getByRole('region', { name: nombre, exact: true });

test('exhibidor: venta de mostrador con cobro parcial, abono, entrega parcial, cierre bloqueado y cierre', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const vendedora = `Lupita ${m}`;
  const nombre = `Vitrina dinero ${m}`;
  // Prefijo propio: la base es la misma para todo el proyecto y «ED» ya lo usa pedidos.spec.ts.
  const [a, b, c] = [`XD${m}01`, `XD${m}02`, `XD${m}03`];
  await sembrarVendedora(vendedora);
  await sembrarPiezas([a, b, c], 10000);

  // Crear el exhibidor y enviarle las tres piezas.
  await irA(page, '/panel/exhibidores');
  await elegirOpcion(page, 'Vendedor', vendedora, true);
  await page.getByLabel('Nombre del exhibidor').fill(nombre);
  await page.getByRole('button', { name: 'Crear exhibidor' }).click();
  await expect(estadoCon(page, 'Exhibidor creado.')).toBeVisible();
  await page.getByRole('link', { name: nombre }).click();
  await expect(page.getByRole('heading', { name: nombre, exact: true })).toBeVisible();

  await page.getByLabel('Códigos a enviar').fill([a, b, c].join(' '));
  await page.getByRole('button', { name: 'Enviar piezas' }).click();
  await expect(estadoCon(page, '3 piezas enviadas.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Piezas en el exhibidor (3)' })).toBeVisible();

  // Venta sin clienta de dos piezas ($200.00), cobrando solo $120.00: la nota queda con saldo de $80.00.
  const venta = formulario(page, 'Registrar venta');
  await venta.getByLabel('Códigos vendidos').fill(`${a} ${b}`);
  await venta.getByLabel('Sin clienta (venta de mostrador)').check();
  await expect(venta.getByText('Total de la nota: $200.00')).toBeVisible();
  await venta.getByLabel('Cobrado por el exhibidor').fill('120');
  await expect(venta.getByText('La nota queda con saldo de $80.00.')).toBeVisible();
  await venta.getByRole('button', { name: 'Registrar venta' }).click();
  await expect(estadoCon(page, /^Venta .* registrada\.$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ventas (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Piezas en el exhibidor (1)' })).toBeVisible();
  await expect(porEntregar(page)).toContainText('$120.00');

  // Abono de los $80.00 restantes, cobrado por el exhibidor: la nota se liquida y el por entregar sube a $200.00.
  const abono = formulario(page, 'Registrar abono');
  await expect(abono.getByLabel('Monto')).toHaveValue('80.00');
  await abono.getByRole('button', { name: 'Registrar abono' }).click();
  await expect(estadoCon(page, 'Abono registrado. La nota quedó liquidada.')).toBeVisible();
  await expect(porEntregar(page)).toContainText('$200.00');
  await expect(page.locator('dt:has-text("Cobrado") + dd')).toHaveText('$200.00');

  // Entrega parcial de $50.00: quedan $150.00 por entregar.
  const entrega = formulario(page, 'Registrar entrega');
  await entrega.getByLabel('Monto entregado').fill('50');
  await entrega.getByRole('button', { name: 'Registrar entrega' }).click();
  await expect(estadoCon(page, 'Entrega registrada.')).toBeVisible();
  await expect(porEntregar(page)).toContainText('$150.00');
  await expect(page.locator('dt:has-text("Entregado") + dd')).toHaveText('$50.00');

  // Regresar la pieza que no se vendió; el cierre sigue bloqueado por el dinero pendiente.
  await page.getByLabel('Códigos a regresar').fill(c);
  await page.getByRole('button', { name: 'Regresar piezas' }).click();
  await expect(estadoCon(page, '1 pieza regresada.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Piezas en el exhibidor (0)' })).toBeVisible();

  const confirmar = page.getByLabel('Confirmo que quiero cerrar este exhibidor; no se puede reabrir.');
  await confirmar.check();
  await page.getByRole('button', { name: 'Cerrar exhibidor' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Antes de cerrar, registra la entrega de $150.00 que tiene por entregar.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar exhibidor' })).toBeVisible();

  // Entrega del resto (el monto propone el total pendiente) y cierre.
  await expect(entrega.getByLabel('Monto entregado')).toHaveValue('150.00');
  await entrega.getByRole('button', { name: 'Registrar entrega' }).click();
  await expect(estadoCon(page, 'Entrega registrada.')).toBeVisible();
  await expect(porEntregar(page)).toContainText('$0.00');
  await expect(page.locator('dt:has-text("Entregado") + dd')).toHaveText('$200.00');

  await confirmar.check();
  await page.getByRole('button', { name: 'Cerrar exhibidor' }).click();
  await expect(estadoCon(page, 'Exhibidor cerrado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar exhibidor' })).toHaveCount(0);
});
