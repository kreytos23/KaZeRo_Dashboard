import { expect, test } from '@playwright/test';
import { RUTA_ESTADO, abrirMenuSiMovil } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

test('cada sección tiene su título', async ({ page }) => {
  await page.goto('/panel/inventario');
  await expect(page).toHaveTitle('Inventario · Kazero');
  await page.goto('/panel/vendedores');
  await expect(page).toHaveTitle('Vendedores · Kazero');
  await page.goto('/panel');
  await expect(page).toHaveTitle('Panel · Kazero');
});

test('un registro inexistente muestra la 404 del panel sin revelar nada', async ({ page }) => {
  // El estado HTTP es 200 y no 404: loading.tsx hace que la respuesta empiece a enviarse antes de que la
  // página llame a notFound(). Next marca esa página con noindex, y el panel ya es privado.
  await page.goto('/panel/inventario/NOEXISTE99');
  await expect(page.getByRole('heading', { name: 'No encontramos ese registro' })).toBeVisible();
  await abrirMenuSiMovil(page);
  await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
});

test('una ruta pública inexistente muestra la 404 general', async ({ page }) => {
  await page.goto('/no-existe-esta-ruta');
  await expect(page.getByRole('heading', { name: 'No encontramos esa página' })).toBeVisible();
});

test('las 404 también llevan CSP y cabeceras de seguridad (el proxy las cubre)', async ({ request }) => {
  for (const ruta of ['/no-existe-esta-ruta', '/favicon.icoX']) {
    const r = await request.get(ruta);
    expect(r.status(), ruta).toBe(404);
    expect(r.headers()['content-security-policy'], ruta).toContain("script-src 'self' 'nonce-");
    expect(r.headers()['x-content-type-options'], ruta).toBe('nosniff');
  }
});

test('el error de negocio aparece junto a su campo y conserva lo escrito', async ({ page }, info) => {
  const nombre = `Duplicada ${info.project.name}`;
  await page.goto('/panel/vendedores');
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Nombre').fill(nombre);
    await page.getByLabel('Comisión (%)').fill('18');
    await page.getByRole('button', { name: 'Agregar vendedor' }).click();
    if (i === 0)
      await expect(page.getByRole('status').filter({ hasText: 'Vendedor agregado.' })).toBeVisible();
  }
  const campo = page.getByLabel('Nombre');
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  await expect(campo).toHaveValue(nombre);
  await expect(campo).toBeFocused();
  await expect(campo).toHaveAccessibleDescription('Ya existe un vendedor con ese nombre.');
});

test('un monto inválido se marca en su campo y mueve el foco allí', async ({ page }) => {
  await page.goto('/panel/inventario/nueva');
  await page.getByLabel('Código', { exact: true }).fill('ERR1');
  await page.getByLabel('Categoría').fill('Anillos');
  await page.getByLabel('Descripción').fill('Prueba de monto');
  await page.getByLabel('Precio').fill('mucho');
  await page.getByRole('button', { name: 'Guardar pieza' }).click();
  const precio = page.getByLabel('Precio');
  await expect(precio).toHaveAttribute('aria-invalid', 'true');
  await expect(precio).toBeFocused();
  await expect(precio).toHaveValue('mucho');
  await expect(precio).toHaveAccessibleDescription(/escribe un monto válido/);
  await expect(page.getByLabel('Costo')).not.toHaveAttribute('aria-invalid', 'true');
});

test('dos formularios con el mismo campo describen cada uno su propio error', async ({ page }, info) => {
  const m = info.project.name;
  await page.goto('/panel/vendedores');
  await page.getByLabel('Nombre').fill(`Vend ids ${m}`);
  await page.getByLabel('Comisión (%)').fill('10');
  await page.getByRole('button', { name: 'Agregar vendedor' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Vendedor agregado.' })).toBeVisible();
  await page.goto('/panel/exhibidores');
  await page.getByLabel('Vendedor', { exact: true }).selectOption({ label: `Vend ids ${m}` });
  await page.getByLabel('Nombre del exhibidor').fill(`Exh ids ${m}`);
  await page.getByRole('button', { name: 'Crear exhibidor' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Exhibidor creado.' })).toBeVisible();
  await page.getByRole('link', { name: `Exh ids ${m}` }).click();

  // Enviar y Regresar tienen ambos un campo "codigos": cada error debe colgar de su propio control.
  const enviar = page.getByLabel('Códigos a enviar');
  const regresar = page.getByLabel('Códigos a regresar');
  await enviar.fill(' ');
  await page.getByRole('button', { name: 'Enviar piezas' }).click();
  await expect(enviar).toHaveAccessibleDescription('Escribe al menos un código.');
  await regresar.fill('ZZ1 ZZ1');
  await page.getByRole('button', { name: 'Regresar piezas' }).click();
  await expect(regresar).toHaveAccessibleDescription('Códigos repetidos: ZZ1.');
  await expect(enviar).toHaveAccessibleDescription('Escribe al menos un código.');
  const ids = await Promise.all([enviar, regresar].map((c) => c.getAttribute('aria-describedby')));
  expect(ids[0]).not.toBe(ids[1]);
  await expect(page.locator('p[role="alert"]')).toHaveText([
    'Revisa los campos marcados.',
    'Revisa los campos marcados.',
  ]);
});

test('el nombre accesible de un selector es solo su etiqueta', async ({ page }) => {
  await page.goto('/panel/vendedores');
  await expect(page.getByRole('combobox', { name: 'Tipo', exact: true })).toBeVisible();
});

test('el favicon existe y es público', async ({ request }) => {
  expect((await request.get('/icon.png')).status()).toBe(200);
});

test.describe('sin sesión', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('los iconos y las imágenes de marca se sirven sin sesión', async ({ request }) => {
    for (const [ruta, tipo] of [
      ['/icon.png', 'image/png'],
      ['/apple-icon.png', 'image/png'],
      ['/favicon.ico', 'image/'],
      ['/marca/logo-completo.webp', 'image/webp'],
      ['/marca/logo-horizontal.webp', 'image/webp'],
    ] as const) {
      const r = await request.get(ruta, { maxRedirects: 0 });
      expect(r.status(), ruta).toBe(200);
      expect(r.headers()['content-type'], ruta).toContain(tipo);
      expect(r.headers()['x-content-type-options'], ruta).toBe('nosniff');
      // Binarios públicos: un día de caché, sin immutable (el nombre no lleva hash).
      expect(r.headers()['cache-control'], ruta).toBe('public, max-age=86400');
    }
    // El HTML y las APIs siguen sin caché.
    for (const ruta of ['/login', '/api/health']) {
      const r = await request.get(ruta, { maxRedirects: 0 });
      expect(r.headers()['cache-control'], ruta).toContain('no-store');
    }
    // Fuera de la lista exacta, /marca exige sesión como cualquier otra ruta.
    const r = await request.get('/marca/sub/logo.webp', { maxRedirects: 0 });
    expect(r.status()).toBe(307);
  });

  test('el login muestra el logo de la marca cargado', async ({ page }) => {
    await page.goto('/login');
    const logo = page.getByRole('img', { name: 'KaZeRo. Vida, moda y estilo' });
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  });

  test('el login avisa del bloqueo solo con el motivo exacto', async ({ page }) => {
    await page.goto('/login?motivo=bloqueado');
    await expect(page.locator('p[role="alert"]')).toHaveText('Demasiados intentos. Intenta más tarde.');
    await page.goto('/login?motivo=<b>hola</b>');
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await expect(page.getByText('hola')).toHaveCount(0);
    await page.goto('/login');
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await expect(page).toHaveTitle('Iniciar sesión · Kazero');
  });
});
