import { expect, test } from '@playwright/test';
import { hoyMX } from '../../src/domain/fechas';
import { formatoFolio } from '../../src/domain/pedidos';
import {
  RUTA_ESTADO,
  abrirFiltros,
  irA,
  sembrarCliente,
  sembrarCompras,
  sembrarPedidoConAbonos,
  sembrarPiezas,
  sembrarVendedor,
  sembrarVendedora,
} from './utilidades';

// UI Fase 3: barra inferior, filtros plegables, menú sin salto, inicio con lo pendiente y tarjeta de lealtad.
test.use({ storageState: RUTA_ESTADO });

type Info = { project: { name: string }; retry: number };
const marca = (info: Info) => (info.project.name === 'movil' ? 'M' : 'E');
/** Sufijo único por proyecto y reintento: el primer intento pudo haber sembrado ya los mismos datos. */
const sufijoDe = (info: Info) => `${marca(info)}${info.retry ? ` r${info.retry}` : ''}`;
/** Código de pieza único por proyecto y reintento (sin espacios). */
const codigoDe = (base: string, info: Info) => `${base}${marca(info)}${info.retry ? `R${info.retry}` : ''}`;

test.describe('barra inferior', () => {
  test('celular: está a la vista y «Inventario» navega y se marca como actual', async ({ page }, info) => {
    test.skip(info.project.name !== 'movil', 'La barra solo existe en pantallas < md');
    await irA(page, '/panel');
    const barra = page.getByRole('navigation', { name: 'Accesos rápidos' });
    await expect(barra).toBeVisible();
    await expect(barra.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page');
    await expect(barra.getByRole('link', { name: 'Inventario' })).not.toHaveAttribute('aria-current');

    await barra.getByRole('link', { name: 'Inventario' }).click();
    await expect(page).toHaveURL(/\/panel\/inventario$/);
    await expect(barra.getByRole('link', { name: 'Inventario' })).toHaveAttribute('aria-current', 'page');
    await expect(barra.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
  });

  test('escritorio: la barra no se ve', async ({ page }, info) => {
    test.skip(info.project.name === 'movil');
    await irA(page, '/panel');
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Accesos rápidos' })).toBeHidden();
  });
});

test.describe('filtros del inventario', () => {
  test('celular: panel, etiqueta activa, quitarla con ✕ y «Limpiar filtros»', async ({ page }, info) => {
    test.skip(info.project.name !== 'movil', 'El panel plegable solo existe en pantallas < md');
    const categoria = `CatUI ${sufijoDe(info)}`;
    const con = codigoDe('FU', info);
    const otra = codigoDe('FV', info);
    await sembrarPiezas([con], 14900, () => categoria);
    await sembrarPiezas([otra], 14900);

    await irA(page, '/panel/inventario');
    await expect(page.getByRole('button', { name: 'Filtros (0)' })).toBeVisible();

    // Filtrar por categoría desde el panel.
    let panel = await abrirFiltros(page);
    await panel.getByLabel('Categoría', { exact: true }).fill(categoria);
    await page.keyboard.press('Tab'); // cierra la lista del combo, que cubriría el botón
    await panel.getByRole('button', { name: 'Ver resultados' }).click();
    await expect(page).toHaveURL(/categoria=/);
    const etiqueta = page.getByRole('link', { name: `Quitar filtro: ${categoria}` });
    await expect(etiqueta).toBeVisible();
    await expect(page.getByRole('button', { name: 'Filtros (1)' })).toBeVisible();
    await expect(page.getByRole('link', { name: con, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: otra, exact: true })).toHaveCount(0);

    // Quitarla con su ✕.
    await etiqueta.click();
    await expect(page).not.toHaveURL(/categoria=/);
    await expect(etiqueta).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Filtros (0)' })).toBeVisible();

    // Volver a filtrar y limpiar desde el panel.
    panel = await abrirFiltros(page);
    await panel.getByLabel('Categoría', { exact: true }).fill(categoria);
    await page.keyboard.press('Tab');
    await panel.getByRole('button', { name: 'Ver resultados' }).click();
    await expect(etiqueta).toBeVisible();
    panel = await abrirFiltros(page);
    await panel.getByRole('link', { name: 'Limpiar filtros' }).click();
    await expect(page).not.toHaveURL(/categoria=/);
    await expect(page.getByRole('link', { name: /^Quitar filtro:/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Filtros (0)' })).toBeVisible();
  });

  test('escritorio: con un filtro puesto, «Limpiar filtros» se ve y lo quita', async ({ page }, info) => {
    test.skip(info.project.name === 'movil');
    const categoria = `CatUI ${sufijoDe(info)}`;
    const con = codigoDe('FU', info);
    await sembrarPiezas([con], 14900, () => categoria);

    await irA(page, '/panel/inventario');
    // Sin filtros no hay nada que limpiar.
    await expect(page.getByRole('link', { name: 'Limpiar filtros' })).toHaveCount(0);

    await irA(page, `/panel/inventario?categoria=${encodeURIComponent(categoria)}`);
    await expect(page.getByRole('link', { name: con, exact: true })).toBeVisible();
    const limpiar = page.getByRole('link', { name: 'Limpiar filtros' });
    await expect(limpiar).toBeVisible();
    await limpiar.click();
    await expect(page).toHaveURL(/\/panel\/inventario$/);
    await expect(limpiar).toHaveCount(0);
  });
});

test('escritorio: abrir «Más acciones» no mueve el encabezado de la ficha', async ({ page }, info) => {
  test.skip(info.project.name === 'movil');
  const codigo = codigoDe('MA', info);
  await sembrarPiezas([codigo], 14900);

  await irA(page, `/panel/inventario/${codigo}`);
  // Por CSS y no por rol: con el menú abierto Radix marca con aria-hidden todo lo de fuera (menú modal), así que
  // el h1 sale del árbol de accesibilidad y getByRole ya no lo encontraría para medirlo después.
  const titulo = page.locator('main h1').filter({ hasText: codigo });
  await expect(page.getByRole('heading', { level: 1, name: codigo })).toBeVisible();
  await expect(titulo).toHaveCount(1);
  const antes = await titulo.boundingBox();
  expect(antes).not.toBeNull();

  const boton = page.getByRole('button', { name: 'Más acciones' });
  const opcion = page.getByRole('menuitem', { name: 'Editar pieza', exact: true });
  // Hasta hidratar, el clic no abre nada: se reintenta hasta ver el menú.
  await expect(async () => {
    if (!(await opcion.isVisible())) await boton.click();
    await expect(opcion).toBeVisible({ timeout: 1_000 });
  }).toPass();

  const despues = await titulo.boundingBox();
  expect(despues).not.toBeNull();
  // Un menú que oculta la barra de desplazamiento corre el contenido a la derecha.
  expect(despues!.x).toBe(antes!.x);
  expect(despues!.y).toBe(antes!.y);
});

test('inicio: «Por cobrar» y el pedido con saldo entre los más atrasados', async ({ page }, info) => {
  const sufijo = sufijoDe(info);
  const vendedoraId = await sembrarVendedora(`Vendedora UI ${sufijo}`);
  const clienta = await sembrarCliente(`Clienta UI ${sufijo}`);
  // Fecha muy antigua: queda entre los primeros de «más atrasados» aunque otras pruebas hayan sembrado deudas.
  const { folio } = await sembrarPedidoConAbonos(clienta, vendedoraId, codigoDe('IN', info), '2020-01-15', [
    { fecha: hoyMX(), centavos: 5000 },
  ]);

  await irA(page, '/panel');
  await expect(page.getByRole('heading', { name: 'Por cobrar' })).toBeVisible();
  await expect(page.getByRole('link', { name: `Vendedora UI ${sufijo}` })).toBeVisible();
  const atrasados = page.locator('section', {
    has: page.getByRole('heading', { name: 'Pedidos más atrasados' }),
  });
  const fila = atrasados.getByRole('listitem').filter({ hasText: formatoFolio(folio) });
  await expect(fila).toContainText(`Clienta UI ${sufijo}`);
  await expect(fila).toContainText('$99.00');
});

test('ficha de clienta con 1 pedido: la tarjeta muestra el avance y lo que falta', async ({ page }, info) => {
  const sufijo = sufijoDe(info);
  const vendedorId = await sembrarVendedor(`Casa UI ${sufijo}`);
  const clienta = await sembrarCliente(`Tarjeta UI ${sufijo}`);
  await sembrarCompras(clienta, vendedorId, 1, codigoDe('TU', info));

  await irA(page, `/panel/clientes/${clienta}`);
  await expect(page.getByText('1 de 10 · faltan 4 para el 10 %')).toBeVisible();
});
