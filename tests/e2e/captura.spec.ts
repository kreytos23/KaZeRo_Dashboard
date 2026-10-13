import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { RUTA_ESTADO, irA } from './utilidades';

/**
 * Captura de inventario pieza por pieza: "Guardar y agregar otra" y los combobox de catálogo (CampoConLista).
 * Corren en escritorio y móvil: cada proyecto usa sus propios códigos (comparten BD).
 */
test.use({ storageState: RUTA_ESTADO });

const marca = (proyecto: string) => (proyecto === 'movil' ? 'M' : 'E');
const estadoCon = (page: Page, texto: string) => page.getByRole('status').filter({ hasText: texto });
const campo = (page: Page, etiqueta: string) => page.getByLabel(etiqueta, { exact: true });

async function llenar(page: Page, o: { codigo: string; descripcion: string; categoria?: string }) {
  await campo(page, 'Código').fill(o.codigo);
  if (o.categoria) await campo(page, 'Categoría').fill(o.categoria);
  await campo(page, 'Descripción').fill(o.descripcion);
  await campo(page, 'Precio').fill('149');
}

test.describe('captura de piezas', () => {
  test.describe.configure({ mode: 'serial' });

  test('guardar y agregar otra conserva catálogos, limpia el resto y la segunda pieza va a su ficha', async ({
    page,
  }, info) => {
    const m = marca(info.project.name);
    const c1 = `CA${m}01`;
    const c2 = `CA${m}02`;
    const proveedor = `Proveedor Captura ${m}`;
    await irA(page, '/panel/inventario/nueva');
    await llenar(page, { codigo: c1, descripcion: `Anillo captura ${m} 1`, categoria: 'Anillos' });
    await campo(page, 'Proveedor').fill(proveedor);
    await page.getByRole('button', { name: 'Guardar y agregar otra' }).click();

    await expect(estadoCon(page, `Pieza ${c1} guardada. Agrega la siguiente.`)).toBeVisible();
    await expect(page.getByRole('link', { name: `Ver ${c1}` })).toBeVisible();
    await expect(page).toHaveURL(/\/panel\/inventario\/nueva$/);
    // Se conservan los catálogos; se limpian código, descripción, costo y precio. El foco va al código.
    await expect(campo(page, 'Categoría')).toHaveValue('Anillos');
    await expect(campo(page, 'Proveedor')).toHaveValue(proveedor);
    await expect(campo(page, 'Código')).toHaveValue('');
    await expect(campo(page, 'Descripción')).toHaveValue('');
    await expect(campo(page, 'Precio')).toHaveValue('');
    await expect(campo(page, 'Código')).toBeFocused();
    // El proveedor recién creado ya aparece en la lista, sin recargar.
    await page.getByRole('button', { name: 'Mostrar opciones de Proveedor' }).click();
    await expect(page.getByRole('option', { name: proveedor, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await llenar(page, { codigo: c2, descripcion: `Anillo captura ${m} 2` });
    await page.getByRole('button', { name: 'Guardar pieza', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/panel/inventario/${c2}$`));

    await irA(page, `/panel/inventario?q=CA${m}0`);
    await expect(page.getByRole('link', { name: c1 })).toBeVisible();
    await expect(page.getByRole('link', { name: c2 })).toBeVisible();
  });

  test('con el prefijo escrito, sugiere el siguiente código y deja el foco en la descripción', async ({
    page,
  }, info) => {
    const m = marca(info.project.name);
    const c1 = `CB${m}01`;
    await irA(page, '/panel/inventario/nueva');
    await campo(page, 'Prefijo').fill(`CB${m}`);
    await llenar(page, { codigo: c1, descripcion: `Pieza sugerida ${m}`, categoria: 'Anillos' });
    await page.getByRole('button', { name: 'Guardar y agregar otra' }).click();
    await expect(estadoCon(page, `Pieza ${c1} guardada.`)).toBeVisible();
    await expect(campo(page, 'Código')).toHaveValue(`CB${m}02`);
    await expect(campo(page, 'Descripción')).toBeFocused();
  });

  test('guardar y agregar otra reinicia la foto: la siguiente pieza no hereda imagen ni vista previa', async ({
    page,
  }, info) => {
    const m = marca(info.project.name);
    const c1 = `CF${m}01`;
    const c2 = `CF${m}02`;
    const foto = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#b4553c' } })
      .jpeg()
      .toBuffer();
    await irA(page, '/panel/inventario/nueva');
    await llenar(page, { codigo: c1, descripcion: `Pieza con foto ${m}`, categoria: 'Anillos' });
    await page
      .getByLabel('Elegir foto')
      .setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: foto });
    await expect(page.getByRole('img', { name: 'Vista previa de la foto' })).toBeVisible();
    await page.getByRole('button', { name: 'Guardar y agregar otra' }).click();
    await expect(estadoCon(page, `Pieza ${c1} guardada.`)).toBeVisible();

    await expect(page.getByRole('img', { name: 'Vista previa de la foto' })).toHaveCount(0);
    for (const entrada of await page.locator('input[type="file"]').all())
      expect(await entrada.evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(0);

    await llenar(page, { codigo: c2, descripcion: `Pieza sin foto ${m}` });
    await page.getByRole('button', { name: 'Guardar pieza', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/panel/inventario/${c2}$`));
    await expect(page.getByText('Sin foto', { exact: true })).toBeVisible();

    await irA(page, `/panel/inventario/${c1}`);
    await expect(page.getByRole('region', { name: 'Foto' }).getByRole('img')).toBeVisible();
  });

  test('CampoConLista: lista existentes, elige con teclado, ofrece Agregar «…» y expone aria', async ({
    page,
  }, info) => {
    const m = marca(info.project.name);
    const nuevo = `Material Nuevo ${m}${Date.now() % 100000}`;
    await irA(page, '/panel/inventario/nueva');
    // Un material existente para tener qué listar.
    await llenar(page, { codigo: `CL${m}01`, descripcion: `Pieza lista ${m}`, categoria: 'Anillos' });
    await campo(page, 'Material').fill('Acero inoxidable');
    await page.getByRole('button', { name: 'Guardar y agregar otra' }).click();
    await expect(estadoCon(page, `Pieza CL${m}01 guardada.`)).toBeVisible();
    await campo(page, 'Material').fill('');
    await page.keyboard.press('Escape');

    const material = campo(page, 'Material');
    await expect(material).toHaveAccessibleName('Material');
    await expect(material).toHaveAttribute('role', 'combobox');
    await expect(material).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Mostrar opciones de Material' }).click();
    await expect(material).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('option', { name: 'Acero inoxidable' })).toBeVisible();

    // Flecha + Enter elige la opción activa, que se anuncia por aria-activedescendant.
    await page.keyboard.press('ArrowDown');
    const activa = await material.getAttribute('aria-activedescendant');
    expect(activa).toBeTruthy();
    await expect(page.locator(`[id="${activa}"]`)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(material).toHaveValue('Acero inoxidable');
    await expect(material).toHaveAttribute('aria-expanded', 'false');

    // Escribir uno nuevo ofrece "Agregar «…»"; Escape cierra sin borrar lo escrito.
    await material.fill(nuevo);
    await expect(page.getByRole('option', { name: `Agregar «${nuevo}»` })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(material).toHaveValue(nuevo);
    await expect(material).toHaveAttribute('aria-expanded', 'false');

    await llenar(page, { codigo: `CL${m}02`, descripcion: `Pieza material nuevo ${m}` });
    await page.getByRole('button', { name: 'Guardar y agregar otra' }).click();
    await expect(estadoCon(page, `Pieza CL${m}02 guardada.`)).toBeVisible();
    await campo(page, 'Material').fill('');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Mostrar opciones de Material' }).click();
    await expect(page.getByRole('option', { name: nuevo, exact: true })).toBeVisible();
  });
});
