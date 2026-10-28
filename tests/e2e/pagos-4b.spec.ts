import { expect, test, type Page } from '@playwright/test';
import {
  abrirAccion,
  irA,
  marcaDe,
  montoSaldoFavor,
  RUTA_ESTADO,
  sembrarCliente,
  sembrarPedidoConAbonos,
  sembrarVendedor,
  sembrarVendedora,
} from './utilidades';

// Plan 4b: pago agrupado de una vendedora, aviso de posible duplicado, deshacer un pago y reembolso al cancelar.
test.use({ storageState: RUTA_ESTADO });

const estadoCon = (page: Page, texto: string | RegExp) => page.getByRole('status').filter({ hasText: texto });
const region = (page: Page, nombre: string) => page.getByRole('region', { name: nombre, exact: true });
const estadoDelPedido = (page: Page, texto: string) => page.getByText(texto, { exact: true }).first();

test('pago agrupado: reparto sugerido, aviso de duplicado y deshacer el pago', async ({ page }, info) => {
  const m = marcaDe(info);
  // Prefijo de pieza propio «PG»: ningún otro spec lo usa.
  const vendedora = `Perla PG ${m}`;
  const antigua = `Clienta Antigua PG ${m}`;
  const nueva = `Clienta Nueva PG ${m}`;
  const vendedoraId = await sembrarVendedora(vendedora);
  const pedidoViejo = await sembrarPedidoConAbonos(
    await sembrarCliente(antigua),
    vendedoraId,
    `PG${m}01`,
    '2026-09-01',
    [],
  );
  const pedidoNuevo = await sembrarPedidoConAbonos(
    await sembrarCliente(nueva),
    vendedoraId,
    `PG${m}02`,
    '2026-09-15',
    [],
  );
  const ficha = `/panel/vendedores/${vendedoraId}`;

  // 1. Pago de $400.00 para dos saldos de $149.00: el reparto sugerido liquida ambos y sobran $102.00.
  await irA(page, ficha);
  const agrupado = region(page, 'Registrar pago agrupado');
  await agrupado.getByLabel('Monto del pago', { exact: true }).fill('400');
  const filaVieja = agrupado.getByRole('listitem').filter({ hasText: antigua });
  const filaNueva = agrupado.getByRole('listitem').filter({ hasText: nueva });
  await expect(filaVieja.getByRole('textbox')).toHaveValue('149.00');
  await expect(filaNueva.getByRole('textbox')).toHaveValue('149.00');
  await expect(
    agrupado.getByText(/Repartido \$298\.00\. Sobran \$102\.00: quedan como saldo a favor de/),
  ).toBeVisible();
  await agrupado.getByRole('button', { name: 'Registrar pago agrupado', exact: true }).click();
  await expect(
    estadoCon(page, 'Pago registrado. Sobraron $102.00: quedan como saldo a favor de la vendedora.'),
  ).toBeVisible();
  await expect(montoSaldoFavor(page)).toHaveText('$102.00');
  for (const { folio } of [pedidoViejo, pedidoNuevo]) {
    await irA(page, `/panel/pedidos/${folio}`);
    await expect(estadoDelPedido(page, 'Liquidado')).toBeVisible();
  }

  // 2. El mismo pago otra vez (monto, fecha y pagadora): avisa del parecido y exige la casilla para guardar.
  await irA(page, ficha);
  await agrupado.getByLabel('Monto del pago', { exact: true }).fill('400');
  await agrupado.getByRole('button', { name: 'Registrar pago agrupado', exact: true }).click();
  await expect(agrupado.getByText('Revisa antes de guardar: ya hay un pago parecido.')).toBeVisible();
  const enlacePrimerPago = agrupado.locator('a[href^="/panel/pagos/"]').first();
  const rutaPrimerPago = await enlacePrimerPago.getAttribute('href');
  expect(rutaPrimerPago).toMatch(/^\/panel\/pagos\/[0-9a-f-]{36}$/);

  // Sin marcar la casilla no se guarda.
  await agrupado.getByRole('button', { name: 'Registrar pago agrupado', exact: true }).click();
  await expect(estadoCon(page, /^Pago registrado/)).toHaveCount(0);
  await expect(montoSaldoFavor(page)).toHaveText('$102.00');

  const confirmar = agrupado.getByLabel('Confirmo que no es un duplicado');
  await confirmar.check();
  await expect(confirmar).toBeChecked();
  await agrupado.getByRole('button', { name: 'Registrar pago agrupado', exact: true }).click();
  await expect(
    estadoCon(page, 'Pago registrado. Sobraron $400.00: quedan como saldo a favor de la vendedora.'),
  ).toBeVisible();
  await expect(montoSaldoFavor(page)).toHaveText('$502.00');

  // Otro pago seguido, sin recargar y todo sobrante: el formulario se reinició (llave nueva) y sí se guarda.
  await agrupado.getByLabel('Monto del pago', { exact: true }).fill('50');
  await agrupado.getByRole('button', { name: 'Registrar pago agrupado', exact: true }).click();
  await expect(
    estadoCon(page, 'Pago registrado. Sobraron $50.00: quedan como saldo a favor de la vendedora.'),
  ).toBeVisible();
  await expect(montoSaldoFavor(page)).toHaveText('$552.00');

  // 3. Ficha del primer pago: deshacerlo con motivo (su sobrante sigue sin usarse) reabre los dos pedidos.
  await irA(page, rutaPrimerPago!);
  await expect(page.getByRole('heading', { name: 'Pago de $400.00', exact: true })).toBeVisible();
  await abrirAccion(page, 'Deshacer pago');
  const deshacer = region(page, 'Deshacer pago');
  await deshacer.getByLabel('Motivo').fill('Pago capturado por error');
  const entiendo = deshacer.getByLabel('Entiendo que se deshace el pago completo');
  await entiendo.check();
  await expect(entiendo).toBeChecked();
  await deshacer.getByRole('button', { name: 'Deshacer pago', exact: true }).click();
  await expect(estadoCon(page, /^Pago deshecho\. Se reabrieron KZR-\d+, KZR-\d+\.$/)).toBeVisible();
  await expect(page.getByText('Motivo: Pago capturado por error')).toBeVisible();

  for (const { folio } of [pedidoViejo, pedidoNuevo]) {
    await irA(page, `/panel/pedidos/${folio}`);
    await expect(estadoDelPedido(page, 'Abierto')).toBeVisible();
  }
  await irA(page, ficha);
  await expect(montoSaldoFavor(page)).toHaveText('$450.00');
});

test('cancelar un pedido con abono: devolver en efectivo deja el saldo a favor en cero', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const nombre = `Clienta Reembolso PG ${m}`;
  const clienteId = await sembrarCliente(nombre);
  const casaId = await sembrarVendedor(`Casa PG ${m}`);
  // $149.00 con un abono de $50.00 de la clienta: queda abierto, con $50.00 que devolver.
  const { folio } = await sembrarPedidoConAbonos(clienteId, casaId, `PG${m}11`, '2026-09-10', [
    { fecha: '2026-09-10', centavos: 5000 },
  ]);

  await irA(page, `/panel/pedidos/${folio}`);
  await expect(estadoDelPedido(page, 'Abierto')).toBeVisible();
  await abrirAccion(page, 'Cancelar pedido');
  const cancelar = region(page, 'Cancelar pedido');
  await cancelar.getByLabel('Motivo de la cancelación').fill('La clienta ya no lo quiere');
  const efectivo = cancelar.getByLabel(/^Devolver en efectivo ahora/);
  await efectivo.check();
  await expect(efectivo).toBeChecked();
  await cancelar.getByLabel('Nota de la devolución en efectivo').fill('Se entregó en mostrador PG');
  const entiendo = cancelar.getByLabel('Entiendo que cancelar no se puede deshacer');
  await entiendo.check();
  await expect(entiendo).toBeChecked();
  await cancelar.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  await expect(estadoCon(page, 'Pedido cancelado. Entrega $50.00 en efectivo.')).toBeVisible();
  await expect(estadoDelPedido(page, 'Cancelado')).toBeVisible();

  // El saldo a favor de la clienta queda en 0 y el retiro consta en su historial.
  await page.getByRole('link', { name: nombre, exact: true }).click();
  await expect(montoSaldoFavor(page)).toHaveText('$0.00');
  await expect(page.getByRole('list', { name: 'Historial de saldo a favor' })).toContainText(
    'Retiro en efectivo: Se entregó en mostrador PG',
  );
});
