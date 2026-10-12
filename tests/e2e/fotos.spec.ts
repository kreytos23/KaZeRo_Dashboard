import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { chunksWebp } from '../apoyo/imagenes';
import { RUTA_ESTADO, irA } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

// Los dos proyectos comparten la BD: cada uno usa sus propios códigos.
const marca = (proyecto: string) => (proyecto === 'movil' ? 'M' : 'E');
const estadoCon = (page: Page, texto: string) => page.getByRole('status').filter({ hasText: texto });
const SOLO_PIXELES = ['VP8 ', 'VP8L', 'VP8X', 'ALPH'];

/** JPEG sintético (nunca una foto real: el repo es público) con EXIF, GPS y orientación 6, generado en la prueba. */
async function fotoConGps() {
  const buffer = await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#b4553c' },
  })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'Kazero-Prueba' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '19/1 25/1 0/1' },
    })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { name: 'pieza-gps.jpg', mimeType: 'image/jpeg', buffer };
}

/** Abre el desplegable de la foto solo si está cerrado (tras guardar, la ficha lo conserva abierto). */
async function abrirFoto(page: Page, resumen: string) {
  const detalles = page.locator('details').filter({ has: page.getByText(resumen, { exact: true }) });
  if (!(await detalles.evaluate((d: HTMLDetailsElement) => d.open)))
    await detalles.getByText(resumen, { exact: true }).click();
  await expect(detalles).toHaveJSProperty('open', true);
}

async function altaPieza(page: Page, codigo: string, descripcion: string, conFoto: boolean) {
  await irA(page, '/panel/inventario/nueva');
  await page.getByLabel('Código', { exact: true }).fill(codigo);
  await page.getByLabel('Categoría').fill('Anillos');
  await page.getByLabel('Descripción').fill(descripcion);
  await page.getByLabel('Precio').fill('149');
  if (conFoto) {
    await page.getByLabel('Elegir foto').setInputFiles(await fotoConGps());
    await expect(page.getByRole('img', { name: 'Vista previa de la foto' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Guardar pieza' }).click();
  await expect(page).toHaveURL(new RegExp(`/panel/inventario/${codigo}$`));
}

test('alta con foto: se ve en la ficha, limpia (sin EXIF/GPS/ICC), WebP, privada y de caché acotada', async ({
  page,
  playwright,
}, info) => {
  const m = marca(info.project.name);
  const codigo = `FO${m}01`;
  const descripcion = `Anillo con foto ${m}`;
  await altaPieza(page, codigo, descripcion, true);

  const foto = page.getByRole('region', { name: 'Foto' }).getByRole('img', { name: descripcion });
  await expect(foto).toBeVisible();
  // Enderezada: la fuente es 640x480 con orientación 6, así que sale vertical.
  await expect
    .poll(() =>
      foto.evaluate((img: HTMLImageElement) =>
        img.naturalWidth ? img.naturalHeight > img.naturalWidth : null,
      ),
    )
    .toBe(true);

  const src = (await foto.getAttribute('src'))!;
  expect(src).toMatch(/^\/api\/piezas\/[0-9a-f-]{36}\/imagen\?v=[0-9a-f-]{36}&t=grande$/);
  const r = await page.request.get(src);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toBe('image/webp');
  expect(r.headers()['cache-control']).toBe('private, max-age=86400');
  expect(r.headers()['x-content-type-options']).toBe('nosniff');
  const cuerpo = new Uint8Array(await r.body());
  const chunks = chunksWebp(cuerpo);
  expect(chunks.every((c) => SOLO_PIXELES.includes(c))).toBe(true);
  expect(chunks).not.toContain('EXIF');
  expect(chunks).not.toContain('ICCP');
  const bytes = Buffer.from(cuerpo);
  for (const rastro of ['Exif', 'GPS', 'Kazero-Prueba']) expect(bytes.includes(rastro)).toBe(false);

  // Sin sesión (contexto nuevo, sin cookies): 401 JSON, nunca la imagen ni un redirect.
  const anonimo = await playwright.request.newContext({
    baseURL: info.project.use.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const sinSesion = await anonimo.get(src, { maxRedirects: 0 });
  expect(sinSesion.status()).toBe(401);
  expect(await sinSesion.json()).toEqual({ error: 'no_autenticado' });
  // La tarea programada pasa el proxy sin cookie, pero sin bearer válido responde 401.
  const sinBearer = await anonimo.get('/api/tareas/limpiar-imagenes', { maxRedirects: 0 });
  expect(sinBearer.status()).toBe(401);
  const bearerMalo = await anonimo.get('/api/tareas/limpiar-imagenes', {
    headers: { authorization: 'Bearer x' },
    maxRedirects: 0,
  });
  expect(bearerMalo.status()).toBe(401);
  await anonimo.dispose();
});

test('la miniatura aparece en el listado y en el buscador global', async ({ page }, info) => {
  const m = marca(info.project.name);
  const codigo = `FO${m}02`;
  await altaPieza(page, codigo, `Collar miniatura ${m}`, true);

  await irA(page, `/panel/inventario?q=${codigo}`);
  const fila = page.getByRole('row').filter({ hasText: codigo });
  const mini = fila.locator('img');
  await expect(mini).toHaveAttribute('src', /&t=mini$/);
  await expect
    .poll(() => mini.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);

  await page.getByRole('combobox', { name: 'Buscar' }).fill(codigo.toLowerCase());
  const opcion = page.getByRole('option', { name: new RegExp(codigo) });
  await expect(opcion.locator('img')).toHaveAttribute('src', /&t=mini$/);
});

test('agregar, cambiar y quitar la foto desde la ficha quedan en el historial; quitar pide confirmación', async ({
  page,
}, info) => {
  const m = marca(info.project.name);
  const codigo = `FO${m}03`;
  await altaPieza(page, codigo, `Pulsera cambio ${m}`, false);
  const region = page.getByRole('region', { name: 'Foto' });
  await expect(region.getByText('Sin foto')).toBeVisible();

  // Agregar.
  await abrirFoto(page, 'Agregar foto');
  await page.getByLabel('Elegir foto').setInputFiles(await fotoConGps());
  await page.getByRole('button', { name: 'Subir foto' }).click();
  await expect(estadoCon(page, 'Foto guardada.')).toBeVisible();
  const imagen = region.getByRole('img', { name: `Pulsera cambio ${m}` });
  await expect(imagen).toBeVisible();
  const srcAntes = (await imagen.getAttribute('src'))!;

  // Cambiar.
  await abrirFoto(page, 'Cambiar o quitar la foto');
  await page.getByLabel('Elegir foto').setInputFiles(await fotoConGps());
  await page.getByRole('button', { name: 'Cambiar foto' }).click();
  await expect(estadoCon(page, 'Foto guardada.')).toBeVisible();
  await expect(imagen).not.toHaveAttribute('src', srcAntes);
  // La URL vieja ya no sirve la foto: redirige a la vigente.
  expect((await page.request.get(srcAntes, { maxRedirects: 0 })).status()).toBe(307);

  // Quitar: exige marcar la confirmación.
  const confirmar = page.getByLabel('Confirmo que quiero quitar la foto.');
  await expect(confirmar).toHaveAttribute('required', '');
  await confirmar.check();
  await page.getByRole('button', { name: 'Quitar foto' }).click();
  // El aviso vive en el formulario de quitar, que desaparece con la foto: la prueba es el marcador.
  await expect(region.getByText('Sin foto')).toBeVisible();

  const historial = page.getByRole('region', { name: 'Historial de cambios' });
  await expect(historial).toContainText('Foto: agregada');
  await expect(historial).toContainText('Foto: cambiada');
  await expect(historial).toContainText('Foto: quitada');
  // Sin foto la ruta responde 404, no una imagen vieja.
  expect((await page.request.get(srcAntes, { maxRedirects: 0 })).status()).toBe(404);
});

test('un archivo que no es foto se rechaza junto al campo (aunque diga image/jpeg)', async ({ page }) => {
  await irA(page, '/panel/inventario/nueva');
  await page.getByLabel('Elegir foto').setInputFiles({
    name: 'nota.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('no soy una foto'),
  });
  await expect(page.getByText(/No se pudo leer la foto/)).toBeVisible();
  await expect(page.getByRole('img', { name: 'Vista previa de la foto' })).toHaveCount(0);
});
