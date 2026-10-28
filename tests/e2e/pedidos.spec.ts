import { expect, test, type Page } from '@playwright/test';
import {
  abrirAccion,
  abrirFiltros,
  type Ambito,
  elegirOpcion,
  fijarFecha,
  irA,
  marcaDe,
  montoSaldoFavor,
  RUTA_ESTADO,
  sembrarCliente,
  sembrarCompras,
  sembrarExhibidorConPieza,
  sembrarPedidoAbierto,
  sembrarPedidoConExhibidor,
  sembrarPiezas,
  sembrarVendedor,
} from './utilidades';

test.use({ storageState: RUTA_ESTADO });

// Los dos proyectos (escritorio y móvil) usan ramas distintas, pero cada uno conserva sus propios nombres y códigos.
// Marca de proyecto y reintento (`marcaDe`): el reintento de CI no repite nombres ni códigos del intento anterior.
const estadoCon = (page: Page, texto: string) => page.getByRole('status').filter({ hasText: texto });
const resumen = (page: Page) => page.getByRole('region', { name: 'Resumen del pedido' });
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

async function agregarPieza(page: Page, codigo: string) {
  await page.getByLabel('Código de pieza').fill(codigo);
  await page.getByLabel('Código de pieza').press('Enter');
  await expect(
    page.getByRole('list', { name: 'Piezas del pedido' }).getByText(codigo.toUpperCase()),
  ).toBeVisible();
}
async function elegirCliente(page: Page, nombre: string) {
  const combo = page.getByRole('combobox', { name: 'Cliente' });
  await combo.fill(nombre);
  // El nombre accesible de la opción incluye el subtítulo (referencia): se ancla al inicio.
  await page.getByRole('option', { name: new RegExp(`^${nombre}`) }).click();
}
/**
 * Rellena los filtros del listado y los aplica: desde `md`, en el formulario en línea con «Filtrar»; en celular,
 * en el panel «Filtros» (sus campos solo existen con él abierto) con «Ver resultados».
 */
async function filtrar(page: Page, rellenar: (ambito: Ambito) => Promise<void>) {
  if (!(await page.getByRole('button', { name: /^Filtros \(\d+\)$/ }).isVisible())) {
    await rellenar(page);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    return;
  }
  const panel = await abrirFiltros(page);
  await rellenar(panel);
  await panel.getByRole('button', { name: 'Ver resultados' }).click();
}
async function folioDeLaFicha(page: Page): Promise<number> {
  await expect(page).toHaveURL(/\/panel\/pedidos\/\d+/);
  return Number(/\/panel\/pedidos\/(\d+)/.exec(page.url())![1]);
}
const estadoDePieza = (page: Page) => page.locator('dt:has-text("Estado") + dd');

test('nuevo pedido con alta rápida de cliente, piezas en ráfaga (una de exhibidor), pago parcial, liquidación y tarjeta', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  await sembrarVendedor(`Casa ${m}`);
  await sembrarPiezas([`N${m}01`, `N${m}02`], 14900);
  await sembrarExhibidorConPieza(m, `NX${m}03`);

  await irA(page, '/panel/pedidos/nuevo');
  await page.getByRole('combobox', { name: 'Cliente' }).fill(`Ana Pedido ${m}`);
  await page.getByRole('option', { name: `Crear cliente «Ana Pedido ${m}»` }).click();
  await elegirOpcion(page, 'Vendedor', `Casa ${m}`, true);
  await agregarPieza(page, `n${m}01`);
  await agregarPieza(page, `N${m}02`);
  await expect(resumen(page)).toContainText('$298.00');
  await agregarPieza(page, `NX${m}03`); // la pieza de un exhibidor también se aparta
  // Totales y posición de la tarjeta en vivo, antes de crear nada.
  await expect(resumen(page)).toContainText('Pedido 1 de su tarjeta.');
  await expect(resumen(page)).toContainText('$447.00');
  await page.getByRole('button', { name: 'Crear pedido' }).click();

  const folio = await folioDeLaFicha(page);
  await expect(page.getByRole('heading', { name: `KZR-${folio}` })).toBeVisible();
  await expect(estadoCon(page, 'Pedido creado.')).toBeVisible();
  await expect(page.getByText('Abierto', { exact: true }).first()).toBeVisible();

  // Pago parcial: el pedido sigue abierto y el saldo baja; el monto del siguiente queda prellenado con el saldo.
  await page.getByLabel('Monto', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estadoCon(page, 'Pago registrado.')).toBeVisible();
  await expect(page.getByText('Saldo pendiente: $347.00')).toBeVisible();
  await expect(page.getByLabel('Monto', { exact: true })).toHaveValue('347.00');

  // El resto liquida el pedido.
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estadoCon(page, 'Pago registrado. El pedido quedó liquidado.')).toBeVisible();
  await expect(page.getByText('Liquidado', { exact: true }).first()).toBeVisible();

  // R-15: las piezas quedan vendidas, también la que venía de un exhibidor.
  for (const c of [`N${m}01`, `NX${m}03`]) {
    await page.goto(`/panel/inventario/${c}`);
    await expect(estadoDePieza(page)).toHaveText('Vendida');
  }

  // R-25: la tarjeta del cliente cuenta la compra.
  await page.goto(`/panel/pedidos/${folio}`);
  await page.getByRole('link', { name: `Ana Pedido ${m}`, exact: true }).click();
  await expect(page.getByRole('listitem', { name: `Lugar 1: KZR-${folio}` })).toBeVisible();
});

test('R-22 y R-29 derogada: la quinta compra recibe su descuento aunque haya otra nota con saldo', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const vendedorId = await sembrarVendedor(`Casa5 ${m}`);
  const leal = await sembrarCliente(`Leal ${m}`);
  await sembrarCompras(leal, vendedorId, 4, `C${m}L`);
  const deudora = await sembrarCliente(`Deudora ${m}`);
  await sembrarCompras(deudora, vendedorId, 3, `C${m}D`);
  await sembrarPedidoAbierto(deudora, vendedorId, `C${m}P01`);
  await sembrarPiezas([`Q${m}01`], 14900);

  await irA(page, '/panel/pedidos/nuevo');
  await elegirCliente(page, `Leal ${m}`);
  await agregarPieza(page, `Q${m}01`);
  await expect(resumen(page)).toContainText('Pedido 5 de su tarjeta: −10 %');
  await expect(resumen(page)).toContainText('$134.10');

  await irA(page, '/panel/pedidos/nuevo');
  await elegirCliente(page, `Deudora ${m}`);
  // R-29 derogada (2026-10-23): la nota con saldo ya no quita el descuento. Con 3 liquidadas + 1 abierta, el nuevo es el lugar 5.
  await expect(resumen(page)).toContainText('Pedido 5 de su tarjeta: −10 %');
  await expect(resumen(page)).not.toContainText('sin descuento');
});

test('cancelar regresa la pieza a su exhibidor abierto y libera la posición', async ({ page }, info) => {
  const m = marcaDe(info);
  const { exhibidorId, codigo, folio } = await sembrarPedidoConExhibidor(m);
  await page.goto(`/panel/exhibidores/${exhibidorId}`);
  await expect(page.getByRole('heading', { name: 'Apartadas (1)' })).toBeVisible();
  // Plan 4a: la nota sale en «Apartadas» (con su pieza) y en «Ventas» (pieza apartada desde este exhibidor).
  await expect(
    page.getByRole('region', { name: 'Apartadas (1)' }).getByRole('link', { name: `KZR-${folio}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Ventas (1)' }).getByRole('link', { name: `KZR-${folio}` }),
  ).toBeVisible();

  await irA(page, `/panel/pedidos/${folio}`);
  await abrirAccion(page, 'Cancelar pedido');
  await page.getByLabel('Motivo de la cancelación').fill('Cambio de opinión');
  // Sin la casilla de confirmación el formulario no se envía.
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(estadoCon(page, 'Pedido cancelado.')).toHaveCount(0);
  await page.getByLabel('Entiendo que cancelar no se puede deshacer').check();
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(estadoCon(page, 'Pedido cancelado.')).toBeVisible();
  await expect(page.locator('.aviso-atencion', { hasText: 'Cambio de opinión' })).toBeVisible();

  await page.goto(`/panel/exhibidores/${exhibidorId}`);
  await expect(page.getByRole('heading', { name: 'Piezas en el exhibidor (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: codigo }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Apartadas (0)' })).toBeVisible();
});

test('cancelar un pedido con abono muestra el saldo a favor del cliente y libera las piezas', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const vendedorId = await sembrarVendedor(`CasaC ${m}`);
  const clienteId = await sembrarCliente(`Cancela ${m}`);
  const { folio } = await sembrarPedidoAbierto(clienteId, vendedorId, `CN${m}01`);

  await irA(page, `/panel/pedidos/${folio}`);
  await page.getByLabel('Monto', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estadoCon(page, 'Pago registrado.')).toBeVisible();
  // El panel de cancelación ya advierte que lo abonado pasa a saldo a favor.
  await abrirAccion(page, 'Cancelar pedido');
  await expect(page.getByText('quedará como saldo a favor')).toBeVisible();
  await page.getByLabel('Motivo de la cancelación').fill('No pudo pagar');
  await page.getByLabel('Entiendo que cancelar no se puede deshacer').check();
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(estadoCon(page, 'Pedido cancelado.')).toBeVisible();

  await page.goto(`/panel/clientes/${clienteId}`);
  await expect(montoSaldoFavor(page)).toHaveText('$50.00');
  await page.goto(`/panel/inventario/CN${m}01`);
  await expect(estadoDePieza(page)).toHaveText('Disponible');
});

test('editar un pedido abierto: agregar y quitar piezas; el descuento manual exige motivo', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const vendedorId = await sembrarVendedor(`CasaE ${m}`);
  const clienteId = await sembrarCliente(`Edita ${m}`);
  const { folio } = await sembrarPedidoAbierto(clienteId, vendedorId, `ED${m}01`);
  await sembrarPiezas([`ED${m}02`], 14900);

  // Agregar una pieza cambia el total: sin motivo se rechaza, con motivo se guarda.
  await irA(page, `/panel/pedidos/${folio}/editar`);
  // Guardar sin cambios no consume la llave: la edición real que sigue (misma página) debe aceptarse.
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('No hay cambios que guardar.')).toBeVisible();
  await page.getByLabel('Agregar piezas').fill(`ed${m}02`);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Escribe el motivo del cambio.')).toBeVisible();
  await page.getByLabel('Motivo del cambio').fill('Agregó otra pieza');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();
  await expect(page.getByRole('link', { name: `ED${m}02` })).toBeVisible();
  await expect(page.getByText('$298.00').first()).toBeVisible();

  // Descuento manual (R-13): exige su propio motivo.
  await irA(page, `/panel/pedidos/${folio}/editar`);
  await page.getByLabel('Descuento manual', { exact: true }).fill('50');
  await page.getByLabel('Motivo del cambio').fill('Cortesía de la casa');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Escribe el motivo del descuento.')).toBeVisible();
  await page.getByLabel('Motivo del descuento').fill('Cliente frecuente');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();
  await expect(page.getByText('Motivo: Cliente frecuente')).toBeVisible();
  await expect(page.getByText('$248.00').first()).toBeVisible();

  // Quitar una pieza: queda en "Piezas quitadas" y el total baja.
  await irA(page, `/panel/pedidos/${folio}/editar`);
  await page.getByLabel(`Quitar ED${m}01`).check();
  await page.getByLabel('Motivo del cambio').fill('Ya no la quiere');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Piezas quitadas' }).getByText(`ED${m}01`)).toBeVisible();
  await expect(page.getByText('$99.00').first()).toBeVisible();
  await page.goto(`/panel/inventario/ED${m}01`);
  await expect(estadoDePieza(page)).toHaveText('Disponible');
});

test('el listado de pedidos filtra por estado, cliente y fechas', async ({ page }, info) => {
  const m = marcaDe(info);
  const vendedorId = await sembrarVendedor(`CasaF ${m}`);
  const abierto = await sembrarCliente(`FiltroAbierto ${m}`);
  const liquidado = await sembrarCliente(`FiltroLiquidado ${m}`);
  const a = await sembrarPedidoAbierto(abierto, vendedorId, `FA${m}01`);
  await sembrarCompras(liquidado, vendedorId, 1, `FL${m}`); // total 0: liquidado al crearse
  await irA(page, '/panel/pedidos');
  const folioA = page.getByRole('link', { name: `KZR-${a.folio}`, exact: true });
  const folioL = page.getByRole('link', { name: `KZR-${a.folio + 1}`, exact: true });

  // Estado.
  await filtrar(page, async (f) => {
    await f.getByLabel('Folio o cliente').fill(`Filtro`);
    await elegirOpcion(f, 'Estado', 'Abierto');
  });
  await expect(page).toHaveURL(/estado=abierto/);
  await expect(folioA).toBeVisible();
  await expect(folioL).toHaveCount(0);
  await filtrar(page, (f) => elegirOpcion(f, 'Estado', 'Liquidado'));
  await expect(page).toHaveURL(/estado=liquidado/);
  await expect(folioL).toBeVisible();
  await expect(folioA).toHaveCount(0);

  // Cliente.
  await filtrar(page, async (f) => {
    await elegirOpcion(f, 'Estado', 'Todos');
    await elegirOpcion(f, 'Cliente', `FiltroAbierto ${m}`, true);
  });
  await expect(page).toHaveURL(/cliente=/);
  // El formulario GET envía también los campos vacíos (`estado=`), como antes de la fase 3: lo que importa es que
  // «Todos» no deje valor.
  await expect(page).not.toHaveURL(/[?&]estado=[^&]/);
  await expect(folioA).toBeVisible();
  await expect(folioL).toHaveCount(0);

  // Fechas: «Hasta» en el pasado no deja nada; el rango que incluye hoy sí.
  await filtrar(page, (f) => fijarFecha(f, 'Hasta', '2020-01-01'));
  await expect(page).toHaveURL(/hasta=2020-01-01/);
  await expect(page.getByText('No hay pedidos con esos filtros.')).toBeVisible();
  await filtrar(page, async (f) => {
    await fijarFecha(f, 'Hasta', '');
    await fijarFecha(f, 'Desde', hoy());
  });
  await expect(page).toHaveURL(/desde=/);
  await expect(page).not.toHaveURL(/[?&]hasta=[^&]/);
  await expect(folioA).toBeVisible();
});

test('la búsqueda global abre un pedido por su folio', async ({ page }, info) => {
  const m = marcaDe(info);
  const vendedorId = await sembrarVendedor(`CasaB ${m}`);
  const cliente = await sembrarCliente(`Busca ${m}`);
  const p = await sembrarPedidoAbierto(cliente, vendedorId, `B${m}01`);
  await page.goto('/panel');
  const buscador = page.getByRole('combobox', { name: 'Buscar' });
  await expect(async () => {
    await page.keyboard.press('/');
    await expect(buscador).toBeFocused({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await buscador.fill(`kzr-${p.folio}`);
  await expect(page.getByRole('option', { name: new RegExp(`KZR-${p.folio}`) })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/panel/pedidos/${p.folio}$`));
});
