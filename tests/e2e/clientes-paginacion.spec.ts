import { expect, test } from '@playwright/test';
import { irA, marcaDe, RUTA_ESTADO, sembrarCliente } from './utilidades';

test.use({ storageState: RUTA_ESTADO });

test('la lista de clientes se pagina de 50 en 50 y conserva el filtro en los enlaces', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const m = marcaDe(info);
  // Prefijo único por proyecto y reintento (`PagEx`, `PagERx`…): el filtro por él aísla estas 51 clientas.
  const prefijo = `Pag${m}x`;
  const numeros = Array.from({ length: 51 }, (_, i) => String(i + 1).padStart(2, '0'));
  for (let i = 0; i < numeros.length; i += 10)
    await Promise.all(numeros.slice(i, i + 10).map((n) => sembrarCliente(`${prefijo} ${n}`)));

  await irA(page, `/panel/clientes?q=${prefijo}`);
  const filas = page.getByRole('link', { name: new RegExp(`^${prefijo} \d{2}$`) });
  await expect(filas).toHaveCount(50);
  await expect(page.getByText('Mostrando 1–50 de 51')).toBeVisible();
  await expect(filas.first()).toHaveText(`${prefijo} 01`);

  await page.getByRole('link', { name: 'Página siguiente' }).click();
  await expect(page).toHaveURL(new RegExp(`pagina=2`));
  await expect(page).toHaveURL(new RegExp(`q=${prefijo}`));
  await expect(filas).toHaveCount(1);
  await expect(filas.first()).toHaveText(`${prefijo} 51`);
  await expect(page.getByText('Mostrando 51–51 de 51')).toBeVisible();

  // Una página fuera de rango muestra la última.
  await irA(page, `/panel/clientes?q=${prefijo}&pagina=99`);
  await expect(filas).toHaveCount(1);

  // Filtrar desde el formulario vuelve a la página 1.
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page).not.toHaveURL(/pagina=/);
  await expect(filas).toHaveCount(50);
});
