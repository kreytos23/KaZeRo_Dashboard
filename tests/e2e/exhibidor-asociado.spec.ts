import { expect, test, type Page } from '@playwright/test';
import {
  elegirOpcion,
  irA,
  marcaDe,
  RUTA_ESTADO,
  sembrarExhibidorConPieza,
  sembrarPedidoConExhibidor,
  sembrarVendedora,
} from './utilidades';

// Corregir el asociado de un exhibidor asignado por error (2026-11-25).
test.use({ storageState: RUTA_ESTADO });

async function abrirEdicion(page: Page) {
  const form = page.getByRole('form', { name: 'Editar exhibidor', exact: true });
  await page.locator('summary').filter({ hasText: 'Editar exhibidor' }).click();
  await expect(form).toBeVisible();
  return form;
}

test('cambiar el asociado desde la ficha: pide motivo, se ve el nombre nuevo y queda en el historial', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const codigo = `AE${m}01`;
  const anterior = `Vend ${codigo}`;
  const nuevo = `Asociada nueva ${m}`;
  const nuevoId = await sembrarVendedora(nuevo);
  const { exhibidorId } = await sembrarExhibidorConPieza(m, codigo);

  await irA(page, `/panel/exhibidores/${exhibidorId}`);
  const form = await abrirEdicion(page);
  await expect(form.getByLabel('Motivo del cambio (opcional)')).toBeVisible();
  await elegirOpcion(form, 'Asociado', nuevo, true);
  await form.getByLabel('Motivo del cambio (obligatorio)').fill('Se asignó por error');
  await form.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(form.getByRole('status')).toHaveText('Cambios guardados.');

  await expect(page.getByRole('link', { name: nuevo, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: anterior, exact: true })).toHaveCount(0);
  const historial = page.getByRole('region', { name: 'Historial de cambios', exact: true });
  await expect(historial).toContainText(`Asociado: ${anterior} → ${nuevo}`);
  await expect(historial).toContainText('Motivo: Se asignó por error');
  await expect(page.getByRole('heading', { level: 2, name: 'Piezas en el exhibidor (1)' })).toBeVisible();

  // La ficha del asociado nuevo ya lo lista.
  await irA(page, `/panel/vendedores/${nuevoId}`);
  await expect(
    page
      .getByRole('region', { name: 'Exhibidores', exact: true })
      .getByRole('link', { name: `Exh ${m} ${codigo}`, exact: true }),
  ).toBeVisible();
});

test('un exhibidor con una venta tiene el asociado bloqueado y explica por qué', async ({ page }, info) => {
  const { exhibidorId } = await sembrarPedidoConExhibidor(marcaDe(info), 'AV');
  await irA(page, `/panel/exhibidores/${exhibidorId}`);
  const form = await abrirEdicion(page);
  const asociado = form.getByLabel('Asociado', { exact: true });
  await expect(asociado).toBeDisabled();
  await expect(asociado).toHaveAccessibleDescription(
    'Este exhibidor ya tiene ventas, apartados o dinero: su asociado no se puede cambiar.',
  );
  // Lo demás se sigue editando.
  const nombre = `Vitrina con venta ${marcaDe(info)}`;
  await form.getByLabel('Nombre', { exact: true }).fill(nombre);
  await form.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(form.getByRole('status')).toHaveText('Cambios guardados.');
  await expect(page.getByRole('heading', { level: 1, name: nombre, exact: true })).toBeVisible();
  await expect(asociado).toBeDisabled();
});
