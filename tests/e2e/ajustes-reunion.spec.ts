import { expect, test, type Page } from '@playwright/test';
import {
  elegirOpcion,
  irA,
  marcaDe,
  montoSaldoFavor,
  RUTA_ESTADO,
  sembrarCliente,
  sembrarCompras,
  sembrarPedidoAbierto,
  sembrarPiezas,
  sembrarVendedor,
  sembrarVendedora,
} from './utilidades';

// Ajustes de la reunión del 2026-10-23 (Plan 3.1): tarjeta de 10, ubicación con vendedora, devolución y saldo a favor.
test.use({ storageState: RUTA_ESTADO });

// Marca de proyecto y reintento (`marcaDe`): el reintento de CI no repite nombres ni códigos del intento anterior.
const estadoCon = (page: Page, texto: string) => page.getByRole('status').filter({ hasText: texto });
const resumen = (page: Page) => page.getByRole('region', { name: 'Resumen del pedido' });

async function agregarPieza(page: Page, codigo: string) {
  await page.getByLabel('Código de pieza').fill(codigo);
  await page.getByLabel('Código de pieza').press('Enter');
  await expect(page.getByRole('list', { name: 'Piezas del pedido' }).getByText(codigo)).toBeVisible();
}
async function elegirCliente(page: Page, nombre: string) {
  const combo = page.getByRole('combobox', { name: 'Cliente' });
  await combo.fill(nombre);
  await page.getByRole('option', { name: new RegExp(`^${nombre}`) }).click();
}
const folioDeLaFicha = async (page: Page): Promise<number> => {
  await expect(page).toHaveURL(/\/panel\/pedidos\/\d+/);
  return Number(/\/panel\/pedidos\/(\d+)/.exec(page.url())![1]);
};

test('tarjeta de 10: el quinto pedido abierto recibe 10 % aunque otra nota tenga saldo, y la ficha muestra 5 de 10', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const vendedorId = await sembrarVendedor(`Casa T${m}`);
  const cliente = await sembrarCliente(`Tarjeta ${m}`);
  await sembrarCompras(cliente, vendedorId, 3, `T${m}L`);
  await sembrarPedidoAbierto(cliente, vendedorId, `T${m}P1`); // nota con saldo pendiente: ya no quita el descuento
  await sembrarPiezas([`T${m}Q1`], 14900);

  await irA(page, '/panel/pedidos/nuevo');
  await elegirCliente(page, `Tarjeta ${m}`);
  await agregarPieza(page, `T${m}Q1`);
  await expect(resumen(page)).toContainText('Pedido 5 de su tarjeta: −10 %');
  await expect(resumen(page)).toContainText('$134.10');
  await page.getByRole('button', { name: 'Crear pedido' }).click();
  await folioDeLaFicha(page);
  await expect(page.getByText('Lugar 5: −10 %')).toBeVisible();

  await page.getByRole('link', { name: `Tarjeta ${m}` }).click();
  await expect(page.getByText('5 de 10')).toBeVisible();
});

test('pieza con vendedora: se entrega desde su ficha, aparece filtrada en el inventario y se vende en su nota', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const nombre = `Rosa ${m}`;
  const vendedoraId = await sembrarVendedora(nombre);
  await sembrarCliente(`Cliente V ${m}`);
  const codigo = `VC${m}01`;
  await sembrarPiezas([codigo], 14900);

  await irA(page, `/panel/vendedores/${vendedoraId}`);
  await page.getByLabel(`Entregar a ${nombre}`).fill(codigo);
  await page.getByRole('button', { name: `Entregar a ${nombre}` }).click();
  await expect(estadoCon(page, '1 pieza entregada.')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Piezas en su poder' }).getByRole('link', { name: codigo }),
  ).toBeVisible();

  await irA(page, `/panel/inventario?ubicacion=vendedora&vendedor=${vendedoraId}`);
  await expect(
    page.getByRole('row').or(page.getByRole('listitem')).filter({ hasText: codigo }),
  ).toContainText(`Con ${nombre}`);

  await irA(page, '/panel/pedidos/nuevo');
  await elegirCliente(page, `Cliente V ${m}`);
  await elegirOpcion(page, 'Vendedor', nombre);
  await agregarPieza(page, codigo);
  await expect(page.getByRole('list', { name: 'Piezas del pedido' })).toContainText(`Con ${nombre}`);
  await page.getByRole('button', { name: 'Crear pedido' }).click();
  await folioDeLaFicha(page);
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estadoCon(page, 'Pago registrado. El pedido quedó liquidado.')).toBeVisible();

  await page.goto(`/panel/inventario/${codigo}`);
  await expect(page.locator('dt:has-text("Estado") + dd')).toHaveText('Vendida');
});

test('devolver una pieza de un pedido liquidado da saldo a favor, que se usa en otro pedido y se retira en efectivo', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const vendedorId = await sembrarVendedor(`Casa D${m}`);
  const nombre = `Devuelve ${m}`;
  const cliente = await sembrarCliente(nombre);
  const p1 = `D${m}P01`;
  const { folio } = await sembrarPedidoAbierto(cliente, vendedorId, p1);
  const segundo = await sembrarPedidoAbierto(cliente, vendedorId, `D${m}P02`);

  // Liquidar el primero y devolver su pieza.
  await irA(page, `/panel/pedidos/${folio}`);
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estadoCon(page, 'Pago registrado. El pedido quedó liquidado.')).toBeVisible();
  await page.getByText('Devolver por defecto').click();
  await page.getByLabel('Motivo de la devolución').fill('Broche roto');
  const casilla = page.getByLabel(`Confirmo la devolución de ${p1}`);
  await casilla.check();
  await expect(casilla).toBeChecked();
  await page.getByRole('button', { name: `Devolver ${p1}` }).click();
  await expect(estadoCon(page, 'Pieza devuelta')).toBeVisible();
  await expect(page.getByText(/Devuelta el .* \$149\.00 a saldo a favor — Broche roto/)).toBeVisible();
  await expect(page.getByText('Devuelto: $149.00')).toBeVisible();

  // El saldo aparece en la ficha del cliente, con su historial.
  await page.getByRole('link', { name: nombre }).click();
  await expect(montoSaldoFavor(page)).toHaveText('$149.00');
  await expect(page.getByText(`Devolución de KZR-${folio}: Broche roto`)).toBeVisible();

  // Usar parte del saldo en el segundo pedido.
  await irA(page, `/panel/pedidos/${segundo.folio}`);
  await elegirOpcion(page, 'Método', 'Saldo a favor (disponible $149.00)');
  await page.getByLabel('Monto', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estadoCon(page, 'Pago registrado.')).toBeVisible();

  // Retirar el resto en efectivo.
  await page.getByRole('link', { name: nombre }).click();
  await expect(montoSaldoFavor(page)).toHaveText('$49.00');
  await expect(page.getByText(`Usado en KZR-${segundo.folio}`)).toBeVisible();
  await expect(page.getByLabel('Monto a devolver')).toHaveValue('49.00');
  await page.getByLabel('Nota del retiro').fill('Se entregó en mostrador');
  await page.getByRole('button', { name: 'Devolver en efectivo' }).click();
  // Sin la casilla de confirmación no se envía.
  await expect(estadoCon(page, 'Retiro registrado.')).toHaveCount(0);
  await page.getByLabel('Confirmo que entregué el efectivo').check();
  await page.getByRole('button', { name: 'Devolver en efectivo' }).click();
  await expect(estadoCon(page, 'Retiro registrado.')).toBeVisible();
  await expect(page.getByText('Retiro en efectivo: Se entregó en mostrador')).toBeVisible();
});
