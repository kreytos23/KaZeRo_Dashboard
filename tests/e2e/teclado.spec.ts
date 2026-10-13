import { expect, test, type Locator, type Page } from '@playwright/test';
import { RUTA_ESTADO, abrirMenuSiMovil, codigoTotpNoUsado, datosAdmin, irA } from './utilidades';

/**
 * Formularios completados SOLO con el teclado: nada de clics ni `fill`. Lo único que no es teclado es
 * `goto` (la barra de direcciones). Si un control fuera inalcanzable con Tab, `enfocar` fallaría.
 */
test.use({ storageState: RUTA_ESTADO });

const marca = (proyecto: string) => (proyecto === 'movil' ? 'M' : 'E');
const estadoCon = (page: Page, texto: string) => page.getByRole('status').filter({ hasText: texto });

/** Avanza con Tab hasta que `destino` tenga el foco. */
async function enfocar(page: Page, destino: Locator, maximo = 80) {
  for (let i = 0; i < maximo; i++) {
    if (await destino.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Inalcanzable con Tab');
}

async function escribirEn(page: Page, destino: Locator, texto: string) {
  await enfocar(page, destino);
  await page.keyboard.type(texto);
}

/** Pone el foco en un campo con Tab y comprueba que la siguiente parada es la esperada (orden visual). */
async function tabHacia(page: Page, siguiente: Locator) {
  await page.keyboard.press('Tab');
  await expect(siguiente).toBeFocused();
}

test.describe('formularios solo con teclado', { tag: '@escritorio' }, () => {
  // La pieza y el exhibidor de una prueba los usa la siguiente.
  test.describe.configure({ mode: 'serial' });

  test('alta de vendedor: orden de Tab, selector con flechas y Enter envía', async ({ page }, info) => {
    const m = marca(info.project.name);
    await irA(page, '/panel/vendedores');
    const nombre = page.getByLabel('Nombre');
    await escribirEn(page, nombre, `Teclado ${m}`);
    await tabHacia(page, page.getByLabel('Tipo'));
    await page.keyboard.press('ArrowDown');
    await expect(page.getByLabel('Tipo').locator('option:checked')).toHaveText(
      await page.getByLabel('Tipo').locator('option').nth(1).innerText(),
    );
    await tabHacia(page, page.getByLabel('Comisión (%)'));
    await page.keyboard.press('Control+A');
    await page.keyboard.type('15');
    await page.keyboard.press('Enter');
    await expect(estadoCon(page, 'Vendedor agregado.')).toBeVisible();
    await expect(page.getByRole('link', { name: `Teclado ${m}` })).toBeVisible();
  });

  test('alta de cliente con Enter y edición de su ficha sin ratón', async ({ page }, info) => {
    const m = marca(info.project.name);
    await irA(page, '/panel/clientes');
    await escribirEn(page, page.getByLabel('Nombre', { exact: true }), `Cliente Teclado ${m}`);
    await tabHacia(page, page.getByLabel('Referencia'));
    await page.keyboard.type('Voca 9');
    await page.keyboard.press('Enter');
    await expect(estadoCon(page, 'Cliente agregado.')).toBeVisible();

    const enlace = page.getByRole('link', { name: `Cliente Teclado ${m}` });
    await enfocar(page, enlace);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: `Cliente Teclado ${m}` })).toBeVisible();
    await escribirEn(page, page.getByLabel('Notas'), 'Prefiere oro');
    await enfocar(page, page.getByRole('button', { name: 'Guardar cambios' }));
    await page.keyboard.press('Space');
    await expect(estadoCon(page, 'Cambios guardados.')).toBeVisible();
  });

  test('nueva pieza: Sugerir código con teclado y envío con Enter', async ({ page }, info) => {
    const m = marca(info.project.name);
    const codigo = `K${m}01`;
    await irA(page, '/panel/inventario/nueva');
    await escribirEn(page, page.getByLabel('Prefijo'), `K${m}`);
    await tabHacia(page, page.getByRole('button', { name: 'Sugerir código' }));
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Código', { exact: true })).toHaveValue(codigo);
    await tabHacia(page, page.getByLabel('Código', { exact: true }));
    await tabHacia(page, page.getByLabel('Categoría'));
    await page.keyboard.type('Aretes');
    await tabHacia(page, page.getByLabel('Descripción'));
    await page.keyboard.type(`Arete teclado ${m}`);
    await enfocar(page, page.getByLabel('Precio'));
    await page.keyboard.type('99');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/panel/inventario/${codigo}$`));

    // Ficha: cambio de estado con el selector y Space sobre el botón.
    const nuevo = page.getByLabel('Nuevo estado');
    await enfocar(page, nuevo);
    await page.keyboard.type('Defecto');
    await enfocar(page, page.getByRole('button', { name: 'Cambiar estado' }));
    await page.keyboard.press('Space');
    await expect(estadoCon(page, 'Estado actualizado.')).toBeVisible();
  });

  test('exhibidor: crear, enviar, regresar y cerrar con confirmación, todo con teclado', async ({
    page,
  }, info) => {
    const m = marca(info.project.name);
    const codigo = `K${m}01`;
    // La prueba anterior dejó la pieza en Defecto: se vuelve a Disponible para poder enviarla.
    await irA(page, `/panel/inventario/${codigo}`);
    const nuevo = page.getByLabel('Nuevo estado');
    await enfocar(page, nuevo);
    await page.keyboard.type('Disponible');
    await enfocar(page, page.getByRole('button', { name: 'Cambiar estado' }));
    await page.keyboard.press('Enter');
    await expect(estadoCon(page, 'Estado actualizado.')).toBeVisible();

    await irA(page, '/panel/exhibidores');
    const vendedor = page.getByLabel('Vendedor', { exact: true });
    await enfocar(page, vendedor);
    await page.keyboard.type(`Teclado ${m}`);
    await expect(vendedor.locator('option:checked')).toHaveText(new RegExp(`Teclado ${m}`));
    await tabHacia(page, page.getByLabel('Nombre del exhibidor'));
    await page.keyboard.type(`Exh Teclado ${m}`);
    await page.keyboard.press('Enter');
    await expect(estadoCon(page, 'Exhibidor creado.')).toBeVisible();

    await enfocar(page, page.getByRole('link', { name: `Exh Teclado ${m}` }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: `Exh Teclado ${m}` })).toBeVisible();

    await escribirEn(page, page.getByLabel('Códigos a enviar'), codigo);
    await tabHacia(page, page.getByRole('button', { name: 'Enviar piezas' }));
    await page.keyboard.press('Space');
    await expect(estadoCon(page, '1 pieza enviada.')).toBeVisible();

    await escribirEn(page, page.getByLabel('Códigos a regresar'), codigo);
    await tabHacia(page, page.getByRole('button', { name: 'Regresar piezas' }));
    await page.keyboard.press('Enter');
    await expect(estadoCon(page, '1 pieza regresada.')).toBeVisible();

    // La casilla de confirmación es alcanzable y se marca con Space; sin ella el envío no procede.
    const confirmo = page.getByLabel('Confirmo que quiero cerrar este exhibidor; no se puede reabrir.');
    await enfocar(page, confirmo);
    await page.keyboard.press('Space');
    await expect(confirmo).toBeChecked();
    await tabHacia(page, page.getByRole('button', { name: 'Cerrar exhibidor' }));
    await page.keyboard.press('Enter');
    await expect(estadoCon(page, 'Exhibidor cerrado.')).toBeVisible();
  });
});

test.describe('menú del celular con teclado', () => {
  test('abre, atrapa el foco, cierra con Escape y navega con Enter', async ({ page }, info) => {
    test.skip(info.project.name !== 'movil', 'El menú solo existe en pantallas < md');
    await irA(page, '/panel');
    const boton = page.getByRole('button', { name: 'Menú' });
    await enfocar(page, boton);
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    // Cerrado: sus enlaces no existen para el teclado ni para el árbol de accesibilidad.
    await expect(page.getByRole('link', { name: 'Inventario' })).toHaveCount(0);

    await expect(async () => {
      await page.keyboard.press('Enter');
      await expect(boton).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
    }).toPass();
    await expect(page.getByRole('link', { name: 'Inventario' })).toBeFocused();
    await expect(page.locator('main')).toHaveAttribute('inert', '');

    // Escape cierra y devuelve el foco al botón.
    await page.keyboard.press('Escape');
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    await expect(boton).toBeFocused();
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');

    // Reabre con Space; el foco queda atrapado: tras la última acción vuelve al botón y Shift+Tab da la vuelta.
    await page.keyboard.press('Space');
    await expect(boton).toHaveAttribute('aria-expanded', 'true');
    const salir = page.getByRole('button', { name: 'Cerrar sesión en todos los dispositivos' });
    await enfocar(page, salir);
    await page.keyboard.press('Tab');
    await expect(boton).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(salir).toBeFocused();

    // Elegir una sección con Enter navega, cierra el menú y devuelve el foco al botón.
    await page.keyboard.press('Tab'); // salir -> botón (vuelta completa)
    await expect(boton).toBeFocused();
    await enfocar(page, page.getByRole('link', { name: 'Vendedores' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/panel\/vendedores$/);
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    await expect(boton).toBeFocused();

    // Y la sección actual se marca en el menú.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'Vendedores' })).toHaveAttribute('aria-current', 'page');
  });

  test('en escritorio no hay botón de menú y la navegación está a la vista', async ({ page }, info) => {
    test.skip(info.project.name === 'movil');
    await irA(page, '/panel');
    await expect(page.getByRole('button', { name: 'Menú' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
  });
});

test.describe('login y verificación con teclado', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('Correo, Contraseña, Enter; código TOTP (con foco inicial) y Enter', async ({ page }) => {
    const d = datosAdmin();
    await irA(page, '/login');
    await escribirEn(page, page.getByLabel('Correo'), d.email);
    await tabHacia(page, page.getByLabel('Contraseña'));
    await page.keyboard.type(d.password);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Verificación en dos pasos' })).toBeVisible();
    const codigo = page.getByLabel('Código de 6 dígitos');
    await expect(codigo).toBeFocused(); // autoFocus: se puede teclear sin tocar nada
    await page.keyboard.type(await codigoTotpNoUsado(d.secretoTotp));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Panel Kazero' })).toBeVisible();
    await abrirMenuSiMovil(page);
  });
});

test.describe('foco visible', () => {
  // /panel (nav + contenido) se recorre también en móvil; las demás solo en escritorio (el resto de las
  // pantallas comparten los mismos controles y estilos de foco).
  const PAGINAS = [
    { ruta: '/panel', tag: [] as string[] },
    { ruta: '/panel/inventario', tag: ['@escritorio'] },
    { ruta: '/panel/inventario/nueva', tag: ['@escritorio'] },
    { ruta: '/panel/exhibidores', tag: ['@escritorio'] },
  ];

  for (const { ruta, tag } of PAGINAS) {
    test(
      `todo control alcanzable con Tab muestra un indicador de foco en ${ruta}`,
      { tag },
      async ({ page }) => {
        await irA(page, ruta);
        // Sin esperar, el recorrido pasaría por el esqueleto de loading.tsx y no por la página real.
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const sinIndicador: string[] = [];
        const vistos = new Set<string>();
        for (let i = 0; i < 60; i++) {
          await page.keyboard.press('Tab');
          const r = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const s = getComputedStyle(el);
            const contorno = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
            const sombra = s.boxShadow !== 'none';
            const nombre = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
            return { ok: contorno || sombra, nombre, tabindex: el.getAttribute('tabindex') };
          });
          if (!r) break; // el foco salió de la página
          const clave = `${i}:${r.nombre}`;
          if (vistos.has(r.nombre) && r.nombre.startsWith('body')) break;
          vistos.add(clave);
          if (r.tabindex !== null && Number(r.tabindex) > 0)
            sinIndicador.push(`tabindex positivo en ${r.nombre}`);
          if (!r.ok) sinIndicador.push(r.nombre);
        }
        expect(vistos.size).toBeGreaterThan(3);
        expect(sinIndicador).toEqual([]);
      },
    );
  }
});
