import { expect, test } from '@playwright/test';
import { abrirMenuSiMovil, irA, marcaDe, RUTA_ESTADO, sembrarPiezas, sembrarVendedora } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

test('cada sección tiene su título y las rutas inexistentes muestran su 404 sin revelar nada', async ({
  page,
}) => {
  await irA(page, '/panel/inventario');
  await expect(page).toHaveTitle('Inventario · Kazero');
  await irA(page, '/panel/vendedores');
  await expect(page).toHaveTitle('Asociados · Kazero');
  await irA(page, '/panel');
  await expect(page).toHaveTitle('Panel · Kazero');

  // El estado HTTP es 200 y no 404: loading.tsx hace que la respuesta empiece a enviarse antes de que la
  // página llame a notFound(). Next marca esa página con noindex, y el panel ya es privado.
  await irA(page, '/panel/inventario/NOEXISTE99');
  await expect(page.getByRole('heading', { name: 'No encontramos ese registro' })).toBeVisible();
  await abrirMenuSiMovil(page);
  await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();

  await irA(page, '/no-existe-esta-ruta');
  await expect(page.getByRole('heading', { name: 'No encontramos esa página' })).toBeVisible();
});

test(
  'las 404 también llevan CSP y cabeceras de seguridad (el proxy las cubre)',
  { tag: '@escritorio' },
  async ({ request }) => {
    for (const ruta of ['/no-existe-esta-ruta', '/favicon.icoX']) {
      const r = await request.get(ruta);
      expect(r.status(), ruta).toBe(404);
      expect(r.headers()['content-security-policy'], ruta).toContain("script-src 'self' 'nonce-");
      expect(r.headers()['x-content-type-options'], ruta).toBe('nosniff');
    }
  },
);

test('el error de negocio aparece junto a su campo y conserva lo escrito', async ({ page }, info) => {
  const nombre = `Duplicada ${info.project.name}`;
  await irA(page, '/panel/vendedores');
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Nombre').fill(nombre);
    await page.getByLabel('Comisión (%)').fill('18');
    await page.getByRole('button', { name: 'Agregar asociado' }).click();
    if (i === 0)
      await expect(page.getByRole('status').filter({ hasText: 'Asociado agregado.' })).toBeVisible();
  }
  const campo = page.getByLabel('Nombre');
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  await expect(campo).toHaveValue(nombre);
  await expect(campo).toBeFocused();
  await expect(campo).toHaveAccessibleDescription('Ya existe un asociado con ese nombre.');
});

test('dos formularios con el mismo campo describen cada uno su propio error', async ({ page }, info) => {
  const m = marcaDe(info);
  const nombre = `Ids ${m}`;
  const pieza = `QI${m}01`;
  const vendedoraId = await sembrarVendedora(nombre);
  await sembrarPiezas([pieza], 10000);
  await irA(page, `/panel/vendedores/${vendedoraId}`);

  // Entregar y Regresar mandan ambos un campo "codigos": cada error debe colgar de su propio control.
  const entrega = page.getByRole('form', { name: `Entregar a ${nombre}` });
  const regreso = page.getByRole('form', { name: 'Regresar a Kazero' });
  // Sin piezas en el lote no hay nada que enviar: el botón está apagado.
  await expect(entrega.getByRole('button', { name: `Entregar a ${nombre}` })).toBeDisabled();
  await entrega.getByRole('combobox', { name: 'Buscar pieza' }).fill(pieza);
  await entrega.getByRole('option', { name: new RegExp(pieza) }).click();
  await entrega.getByRole('button', { name: `Entregar 1 pieza a ${nombre}` }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 pieza entregada.' })).toBeVisible();

  const pegarEn = async (form: typeof entrega, codigos: string) => {
    await form.getByText('Pegar varios códigos').click();
    const campo = form.getByLabel('Códigos', { exact: true });
    await campo.fill(codigos);
    return campo;
  };
  const enEntrega = await pegarEn(entrega, `ZQ${m}1`);
  await entrega.getByRole('button', { name: `Entregar 1 pieza a ${nombre}` }).click();
  await expect(enEntrega).toHaveAccessibleDescription(`No se entregó nada. No existen: ZQ${m}1.`);
  const enRegreso = await pegarEn(regreso, `zq${m}2 ZQ${m}2`); // repetido: el lote ya lo manda una vez
  await regreso.getByRole('button', { name: 'Regresar 1 seleccionada' }).click();
  await expect(enRegreso).toHaveAccessibleDescription(`No se regresó nada. No existen: ZQ${m}2.`);
  await expect(enEntrega).toHaveAccessibleDescription(`No se entregó nada. No existen: ZQ${m}1.`);
  await expect(enRegreso).toHaveValue(`zq${m}2 ZQ${m}2`); // el error conserva lo escrito
  const ids = await Promise.all([enEntrega, enRegreso].map((c) => c.getAttribute('aria-describedby')));
  expect(ids[0]).not.toBe(ids[1]);
  await expect(page.locator('p[role="alert"]')).toHaveText([
    'Revisa los campos marcados.',
    'Revisa los campos marcados.',
  ]);
});

test('el nombre accesible de un selector es solo su etiqueta', async ({ page }) => {
  await irA(page, '/panel/vendedores');
  await expect(page.getByRole('combobox', { name: 'Tipo', exact: true })).toBeVisible();
});

test('el favicon existe y es público', { tag: '@escritorio' }, async ({ request }) => {
  expect((await request.get('/icon.png')).status()).toBe(200);
});

test.describe('sin sesión', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    'los iconos y las imágenes de marca se sirven sin sesión',
    { tag: '@escritorio' },
    async ({ request }) => {
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
    },
  );

  test('el login muestra el logo de la marca cargado', async ({ page }) => {
    await irA(page, '/login');
    const logo = page.getByRole('img', { name: 'KaZeRo. Vida, moda y estilo' });
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  });

  test('el login avisa del bloqueo solo con el motivo exacto', { tag: '@escritorio' }, async ({ page }) => {
    await irA(page, '/login?motivo=bloqueado');
    await expect(page.locator('p[role="alert"]')).toHaveText('Demasiados intentos. Intenta más tarde.');
    await irA(page, '/login?motivo=<b>hola</b>');
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await expect(page.getByText('hola')).toHaveCount(0);
    await irA(page, '/login');
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await expect(page).toHaveTitle('Iniciar sesión · Kazero');
  });
});
