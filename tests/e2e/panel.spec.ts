import { expect, test, type Page } from '@playwright/test';
import { RUTA_ESTADO, RUTA_ESTADO_REGEN, datosAdmin, datosAdminRegen } from './utilidades';

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

  await page.goto('/panel/vendedores');
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
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();
  await expect(page.getByLabel('Comisión (%)')).toHaveValue('20');

  await page.goto('/panel/inventario/nueva');
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
  await page.goto('/panel');
  const buscador = await abrirBuscadorConAtajo(page);
  await buscador.fill(codigo.toLowerCase());
  await expect(page.getByRole('option', { name: new RegExp(codigo) })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/panel/inventario/${codigo}$`));

  await page.goto('/panel/exhibidores');
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
  await page.goto('/panel/inventario/nueva');
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

test('cliente con alta rápida se encuentra sin acentos', async ({ page }, info) => {
  const m = marca(info.project.name);
  await page.goto('/panel/clientes');
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
});

test('agregar administrador muestra el QR y los códigos hasta ocultarlos', async ({ page }, info) => {
  const m = marca(info.project.name);
  const correo = `nuevo-${m.toLowerCase()}@kazero.test`;
  await page.goto('/panel/administradores');
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
    await page.goto('/panel/administradores');
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
