import { expect, test, type Page } from '@playwright/test';
import { RUTA_ESTADO, RUTA_ESTADO_REGEN, datosAdmin, datosAdminRegen, irA } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

// Los dos proyectos (escritorio y móvil) comparten la BD: cada uno usa sus propios nombres y códigos.
const marca = (proyecto: string) => (proyecto === 'movil' ? 'M' : 'E');

const estadoCon = (page: Page, texto: string) => page.getByRole('status').filter({ hasText: texto });

async function abrirBuscadorConAtajo(page: Page) {
  const buscador = page.getByRole('combobox', { name: 'Buscar' });
  // El atajo `/` solo existe tras hidratar: se reintenta hasta que el campo recibe el foco.
  await expect(async () => {
    await page.keyboard.press('/');
    await expect(buscador).toBeFocused({ timeout: 500 });
  }).toPass();
  return buscador;
}

test('vendedor, pieza, búsqueda global y exhibidor', async ({ page }, info) => {
  const m = marca(info.project.name);
  const prefijo = `Z${m}`;
  const codigo = `${prefijo}01`;

  await irA(page, '/panel/vendedores');
  await page.getByLabel('Nombre').fill(`Nelly ${m}`);
  await page.getByLabel('Tipo').selectOption('revendedora');
  await page.getByLabel('Comisión (%)').fill('18');
  await page.getByRole('button', { name: 'Agregar vendedor' }).click();
  await expect(estadoCon(page, 'Vendedor agregado.')).toBeVisible();
  await expect(page.getByRole('link', { name: `Nelly ${m}` })).toBeVisible();

  // Ficha del vendedor: tras guardar debe verse la confirmación (regresión de la key/remount).
  await page.getByRole('link', { name: `Nelly ${m}` }).click();
  await expect(page.getByRole('heading', { name: `Nelly ${m}` })).toBeVisible();
  await page.getByLabel('Comisión (%)').fill('20');
  // R-09: cambiar dinero exige motivo; el campo lo anuncia en su etiqueta.
  await expect(page.getByLabel('Motivo del cambio (obligatorio)')).toBeVisible();
  await page.getByLabel('Motivo del cambio').fill('Nueva tabla de comisiones');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();
  await expect(page.getByLabel('Comisión (%)')).toHaveValue('20');
  const historial = page.getByRole('region', { name: 'Historial de cambios' });
  await expect(historial).toContainText('Comisión: 18 % → 20 %');
  await expect(historial).toContainText('Motivo: Nueva tabla de comisiones');

  await irA(page, '/panel/inventario/nueva');
  await page.getByLabel('Prefijo').fill(prefijo);
  await page.getByRole('button', { name: 'Sugerir código' }).click();
  await expect(page.getByLabel('Código', { exact: true })).toHaveValue(codigo);
  await page.getByLabel('Categoría').fill('Anillos');
  await page.getByLabel('Descripción').fill(`Anillo serpiente ${m}`);
  await page.getByLabel('Precio').fill('149');
  await page.getByRole('button', { name: 'Guardar pieza' }).click();
  await expect(page).toHaveURL(new RegExp(`/panel/inventario/${codigo}$`));
  await expect(page.getByRole('heading', { name: codigo })).toBeVisible();

  // Búsqueda global: atajo /, código en minúsculas resuelto por el mapa de códigos, Enter navega.
  await irA(page, '/panel');
  const buscador = await abrirBuscadorConAtajo(page);
  await buscador.fill(codigo.toLowerCase());
  await expect(page.getByRole('option', { name: new RegExp(codigo) })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/panel/inventario/${codigo}$`));

  await irA(page, '/panel/exhibidores');
  await page.getByLabel('Vendedor', { exact: true }).selectOption({ label: `Nelly ${m}` });
  await page.getByLabel('Nombre del exhibidor').fill(`Exhibidor ${m}`);
  await page.getByRole('button', { name: 'Crear exhibidor' }).click();
  await expect(estadoCon(page, 'Exhibidor creado.')).toBeVisible();
  await page.getByRole('link', { name: `Exhibidor ${m}` }).click();
  await expect(page.getByRole('heading', { name: `Exhibidor ${m}` })).toBeVisible();

  await page.getByLabel('Códigos a enviar').fill(codigo.toLowerCase());
  await page.getByRole('button', { name: 'Enviar piezas' }).click();
  await expect(estadoCon(page, '1 pieza enviada.')).toBeVisible();
  await expect(page.getByRole('link', { name: codigo })).toBeVisible();
  await page.getByLabel('Códigos a regresar').fill(codigo);
  await page.getByRole('button', { name: 'Regresar piezas' }).click();
  await expect(estadoCon(page, '1 pieza regresada.')).toBeVisible();
  await expect(page.getByRole('link', { name: codigo })).toHaveCount(0);

  // Cierre: exige confirmar; el aviso persiste y el botón desaparece.
  await page.getByLabel('Confirmo que quiero cerrar este exhibidor; no se puede reabrir.').check();
  await page.getByRole('button', { name: 'Cerrar exhibidor' }).click();
  await expect(estadoCon(page, 'Exhibidor cerrado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar exhibidor' })).toHaveCount(0);
});

test('alta individual, ficha de pieza con destinos válidos y estados', async ({ page }, info) => {
  const m = marca(info.project.name);
  const codigo = `Y${m}01`;
  await irA(page, '/panel/inventario/nueva');
  await page.getByLabel('Prefijo').fill(`Y${m}`);
  await page.getByRole('button', { name: 'Sugerir código' }).click();
  await expect(page.getByLabel('Código', { exact: true })).toHaveValue(codigo);
  await page.getByLabel('Categoría').fill('Collares');
  await page.getByLabel('Descripción').fill(`Collar luna ${m}`);
  await page.getByLabel('Precio').fill('200');
  await page.getByRole('button', { name: 'Guardar pieza' }).click();
  await expect(page).toHaveURL(new RegExp(`/panel/inventario/${codigo}$`));

  const nuevo = page.getByLabel('Nuevo estado');
  await expect(nuevo.locator('option')).toHaveText(['Regalo', 'Defecto', 'Guardada']);
  await nuevo.selectOption({ label: 'Defecto' });
  await page.getByRole('button', { name: 'Cambiar estado' }).click();
  await expect(estadoCon(page, 'Estado actualizado.')).toBeVisible();
  // Desde Defecto solo se puede volver a Disponible.
  await expect(nuevo.locator('option')).toHaveText(['Disponible']);
});

test('editar pieza con motivo por dinero, regalo, deshacer e historiales', async ({ page }, info) => {
  const m = marca(info.project.name);
  const codigo = `W${m}01`;
  await irA(page, '/panel/inventario/nueva');
  await page.getByLabel('Prefijo').fill(`W${m}`);
  await page.getByRole('button', { name: 'Sugerir código' }).click();
  await expect(page.getByLabel('Código', { exact: true })).toHaveValue(codigo);
  await page.getByLabel('Categoría').fill('Pulseras');
  await page.getByLabel('Descripción').fill(`Pulsera mar ${m}`);
  await page.getByLabel('Precio').fill('200');
  await page.getByRole('button', { name: 'Guardar pieza' }).click();
  await expect(page).toHaveURL(new RegExp(`/panel/inventario/${codigo}$`));

  const cambios = page.getByRole('region', { name: 'Historial de cambios' });
  const movimientos = page.getByRole('region', { name: 'Historial de movimientos' });
  await expect(cambios.getByText('Sin cambios registrados.')).toBeVisible();

  // Editar sin dinero: el motivo es opcional.
  await page.getByText('Editar pieza', { exact: true }).click();
  await expect(page.getByLabel('Motivo del cambio (opcional)')).not.toHaveAttribute('required', '');
  await page.getByLabel('Descripción').fill(`Pulsera océano ${m}`);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();
  await expect(cambios.getByText(`Pulsera mar ${m} → Pulsera océano ${m}`)).toBeVisible();

  // Guardar sin tocar nada no escribe nada.
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Sin cambios.')).toBeVisible();

  // Cambiar el precio vuelve obligatorio el motivo (ayuda del cliente; el servidor lo exige igual).
  await page.getByLabel('Precio').fill('250');
  const motivo = page.getByLabel('Motivo del cambio (obligatorio)');
  await expect(motivo).toBeVisible();
  await expect(motivo).toHaveAttribute('required', '');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(motivo).toBeFocused();
  await motivo.fill('Ajuste de lista');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();
  await expect(cambios.getByText(/\$200\.00 → \$250\.00/)).toBeVisible();
  await expect(cambios.getByText('Motivo: Ajuste de lista')).toBeVisible();

  // La edición avisa al buscador: la nueva descripción se encuentra sin recargar.
  const buscador = await abrirBuscadorConAtajo(page);
  await buscador.fill(`oceano ${m.toLowerCase()}`);
  await expect(page.getByRole('option', { name: new RegExp(codigo) })).toBeVisible();
  await buscador.press('Escape');

  // Regalo: el formulario de estado desaparece en el mismo render, pero el índice se marca sucio.
  const reindexado = page.waitForRequest((r) => r.url().includes('/api/busqueda/indice'));
  await page.getByLabel('Nuevo estado').selectOption({ label: 'Regalo' });
  await page.getByRole('button', { name: 'Cambiar estado' }).click();
  await reindexado;
  await expect(page.getByLabel('Nuevo estado')).toHaveCount(0);
  await expect(movimientos.getByText('Cambio de estado').first()).toBeVisible();

  // Deshacer: va junto al último movimiento, con motivo y confirmación.
  await expect(movimientos.getByText('Deshacer: Disponible → Regalo')).toBeVisible();
  await expect(movimientos.getByText('La pieza volverá a Disponible.')).toBeVisible();
  await movimientos.getByLabel('Motivo de la corrección (obligatorio)').fill('Se marcó por error');
  await movimientos.getByRole('button', { name: 'Deshacer este cambio' }).click();
  await expect(movimientos.getByLabel('Confirmo que quiero deshacer este cambio.')).toBeFocused();
  await movimientos.getByLabel('Confirmo que quiero deshacer este cambio.').check();
  await movimientos.getByRole('button', { name: 'Deshacer este cambio' }).click();
  await expect(estadoCon(page, 'Cambio deshecho: la pieza volvió a Disponible.')).toBeVisible();
  // El formulario desaparece: el foco pasa al aviso en vez de perderse en <body>.
  await expect(estadoCon(page, 'Cambio deshecho')).toBeFocused();
  await expect(movimientos.getByRole('button', { name: 'Deshacer este cambio' })).toHaveCount(0);
  await expect(page.getByLabel('Nuevo estado')).toBeVisible();
  await expect(movimientos.getByText('Corrección')).toBeVisible();
  await expect(movimientos.getByText('Se marcó por error')).toBeVisible();
});

test('cliente con alta rápida se encuentra sin acentos', async ({ page }, info) => {
  const m = marca(info.project.name);
  await irA(page, '/panel/clientes');
  await page.getByLabel('Nombre', { exact: true }).fill(`Rocío Santibañez ${m}`);
  await page.getByLabel('Referencia').fill('5to norte');
  await page.getByRole('button', { name: 'Agregar cliente' }).click();
  await expect(estadoCon(page, 'Cliente agregado.')).toBeVisible();

  await page.getByRole('combobox', { name: 'Buscar' }).fill(`santibanez ${m.toLowerCase()}`);
  await expect(page.getByRole('option', { name: new RegExp(`Rocío Santibañez ${m}`) })).toBeVisible();

  // Ficha del cliente: tras guardar debe verse la confirmación.
  await page.getByRole('link', { name: `Rocío Santibañez ${m}` }).click();
  await expect(page.getByRole('heading', { name: `Rocío Santibañez ${m}` })).toBeVisible();
  await page.getByLabel('Notas').fill('Prefiere plata');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();

  // Cambiar el teléfono (sin dinero: el motivo es opcional) deja antes → después en el historial.
  const historial = page.getByRole('region', { name: 'Historial de cambios' });
  await expect(page.getByLabel('Motivo del cambio (opcional)')).toBeVisible();
  await page.getByLabel('Teléfono').fill('5551234567');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(historial).toContainText('Teléfono: — → 5551234567');
  await page.getByLabel('Teléfono').fill('5559876543');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(historial).toContainText('Teléfono: 5551234567 → 5559876543');
  // Sin cambios: no se escribe nada.
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Sin cambios.')).toBeVisible();
});

test('editar un exhibidor abierto y renombrar un catálogo, ambos con historial', async ({ page }, info) => {
  const m = marca(info.project.name);

  await irA(page, '/panel/vendedores');
  await page.getByLabel('Nombre').fill(`Edith ${m}`);
  await page.getByLabel('Tipo').selectOption('consignacion');
  await page.getByLabel('Comisión (%)').fill('10');
  await page.getByRole('button', { name: 'Agregar vendedor' }).click();
  await expect(estadoCon(page, 'Vendedor agregado.')).toBeVisible();

  await irA(page, '/panel/exhibidores');
  await page.getByLabel('Vendedor', { exact: true }).selectOption({ label: `Edith ${m}` });
  await page.getByLabel('Nombre del exhibidor').fill(`Vitrina ${m}`);
  await page.getByRole('button', { name: 'Crear exhibidor' }).click();
  await expect(estadoCon(page, 'Exhibidor creado.')).toBeVisible();
  await page.getByRole('link', { name: `Vitrina ${m}` }).click();
  await expect(page.getByRole('heading', { name: `Vitrina ${m}` })).toBeVisible();

  // Editar nombre (el desplegable se abre con el teclado: es un <summary>).
  await page.getByText('Editar exhibidor').click();
  await page.getByLabel('Nombre', { exact: true }).fill(`Vitrina nueva ${m}`);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();
  await expect(page.getByRole('heading', { name: `Vitrina nueva ${m}` })).toBeVisible();
  const historialEx = page.getByRole('region', { name: 'Historial de cambios' });
  await expect(historialEx).toContainText(`Nombre: Vitrina ${m} → Vitrina nueva ${m}`);

  // Cerrado: ya no se edita y se explica por qué.
  await page.getByLabel('Confirmo que quiero cerrar este exhibidor; no se puede reabrir.').check();
  await page.getByRole('button', { name: 'Cerrar exhibidor' }).click();
  await expect(estadoCon(page, 'Exhibidor cerrado.')).toBeVisible();
  await expect(page.getByText('Editar exhibidor')).toHaveCount(0);
  await expect(page.getByText('Un exhibidor cerrado es un registro histórico')).toBeVisible();

  // Catálogo: renombrar con error por campo si ya existe, y con historial por elemento.
  await irA(page, '/panel/catalogos');
  const viejo = `Cat${m}`;
  const otro = `Otra${m}`;
  const nuevo = `Cat nueva ${m}`;
  for (const nombre of [viejo, otro]) {
    await page.getByLabel('Nueva categoría').fill(nombre);
    await page.getByRole('button', { name: 'Agregar' }).first().click();
    await expect(page.locator('summary', { hasText: nombre })).toBeVisible();
  }
  await page.locator('summary', { hasText: viejo }).click();
  const campo = page.getByLabel(`Nuevo nombre para ${viejo}`);
  await campo.fill(otro);
  await page.getByRole('button', { name: 'Guardar nombre' }).click();
  await expect(page.getByText('Esa categoría ya existe.')).toBeVisible();
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  await campo.fill(nuevo);
  await page.getByRole('button', { name: 'Guardar nombre' }).click();
  await expect(estadoCon(page, 'Nombre actualizado.')).toBeVisible();
  const historialCat = page.getByRole('region', { name: `Cambios de ${nuevo}` });
  await expect(historialCat).toContainText(`Nombre: ${viejo} → ${nuevo}`);
});

test('agregar administrador muestra el QR y los códigos hasta ocultarlos', async ({ page }, info) => {
  const m = marca(info.project.name);
  const correo = `nuevo-${m.toLowerCase()}@kazero.test`;
  await irA(page, '/panel/administradores');
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Agregar administrador' }) });
  await form.getByLabel('Correo del nuevo administrador').fill(correo);
  await form.getByLabel('Contraseña nueva').fill('una-contraseña-larga-123');
  await form.getByLabel('Confirmar contraseña').fill('una-contraseña-larga-123');
  await form.getByLabel('Tu contraseña actual').fill(datosAdmin().password);
  await form.getByRole('button', { name: 'Agregar administrador' }).click();

  await expect(page.getByRole('heading', { name: 'Escanea este código' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Código QR para la app autenticadora' })).toBeVisible();
  const codigos = page.locator('ol[aria-label="Códigos de recuperación"]');
  await expect(codigos.getByRole('listitem')).toHaveCount(8);
  // La revalidación de la página trae al nuevo admin a la lista sin borrar lo mostrado una sola vez.
  await expect(page.getByRole('listitem').filter({ hasText: `${correo} · desde` })).toBeVisible();
  await expect(codigos.getByRole('listitem')).toHaveCount(8);

  await page.getByRole('button', { name: 'Ya los guardé, ocultar' }).click();
  await expect(page.getByRole('heading', { name: 'Escanea este código' })).toHaveCount(0);
  await expect(codigos).toHaveCount(0);
});

test.describe('regenerar TOTP (admin y sesión aparte)', () => {
  // Cambia el secreto y revoca las demás sesiones: no puede tocar al admin que usan el resto de pruebas.
  test.use({ storageState: RUTA_ESTADO_REGEN });
  test('muestra QR y 8 códigos nuevos y la sesión actual sigue viva', async ({ page }) => {
    await irA(page, '/panel/administradores');
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Regenerar mi TOTP' }) });
    await form.getByLabel('Tu contraseña actual').fill(datosAdminRegen().password);
    await form.getByRole('button', { name: 'Regenerar mi TOTP' }).click();
    await expect(page.getByRole('heading', { name: 'Escanea este código' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Código QR para la app autenticadora' })).toBeVisible();
    await expect(page.locator('ol[aria-label="Códigos de recuperación"]').getByRole('listitem')).toHaveCount(
      8,
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Administradores' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Escanea este código' })).toHaveCount(0);
  });
});

test.describe('sin sesión', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('la API privada responde 401 JSON, no un redirect', async ({ request }) => {
    const r = await request.get('/api/busqueda/indice', { maxRedirects: 0 });
    expect(r.status()).toBe(401);
    expect(await r.json()).toEqual({ error: 'no_autenticado' });
  });
});

test('un envío antes de hidratar no pone ningún campo en la URL', async ({ page }) => {
  // Sin JavaScript el formulario nunca se hidrata: el botón sigue deshabilitado y Enter no envía.
  await page.route('**/_next/static/**', (r) => r.abort());
  await page.goto('/panel/administradores');
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Agregar administrador' }) });
  await expect(form).toHaveAttribute('data-hidratado', 'no');
  await expect(form.getByRole('button', { name: 'Agregar administrador' })).toBeDisabled();
  await expect(form).toHaveAttribute('method', /post/i);
  await form.getByLabel('Tu contraseña actual').fill('secreto-que-no-debe-salir');
  await form.getByLabel('Tu contraseña actual').press('Enter');
  await form.evaluate((f) => (f as HTMLFormElement).requestSubmit());
  await page.waitForTimeout(800);
  expect(page.url()).not.toMatch(/passwordActual|secreto-que-no-debe-salir|\?/);
});
