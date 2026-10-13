import { expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generarCodigoTotp } from '../../src/server/auth/totp';

// Cada proceso de Playwright (uno por proyecto, ver scripts/test-neon.ts) usa su propio directorio de datos.
export const DIR_DATOS = process.env.KAZERO_E2E_DATOS ?? 'playwright/.datos';
export const RUTA_DATOS = `${DIR_DATOS}/admin.json`;
export const RUTA_ESTADO = `${DIR_DATOS}/estado.json`;
export const RUTA_ESTADO_REGEN = `${DIR_DATOS}/estado-regen.json`;
export const RUTA_DATOS_REGEN = `${DIR_DATOS}/admin-regen.json`;
export const RUTA_PASO = `${DIR_DATOS}/ultimo-paso`;

export function datosAdmin(): { email: string; password: string; secretoTotp: string } {
  return JSON.parse(readFileSync(RUTA_DATOS, 'utf8'));
}

/** El servidor rechaza reutilizar un paso TOTP: si el actual ya se usó, espera al siguiente (≤30 s). */
export async function codigoTotpNoUsado(secreto: string): Promise<string> {
  const ultimo = existsSync(RUTA_PASO) ? Number(readFileSync(RUTA_PASO, 'utf8')) : 0;
  let paso = Math.floor(Date.now() / 30_000);
  while (paso <= ultimo) {
    await new Promise((r) => setTimeout(r, 1_000));
    paso = Math.floor(Date.now() / 30_000);
  }
  writeFileSync(RUTA_PASO, String(paso));
  // El código se genera para el paso ANOTADO: si el reloj cruzara al siguiente paso entre medias, sin esto
  // el código sería de paso+1 y la siguiente llamada lo repetiría (rechazado por reutilizar el paso).
  return generarCodigoTotp(secreto, new Date(paso * 30_000));
}

/** Admin aparte para regenerar el TOTP: la acción revoca sus otras sesiones y cambia su secreto. */
export function datosAdminRegen(): { email: string; password: string } {
  return JSON.parse(readFileSync(RUTA_DATOS_REGEN, 'utf8'));
}

/** En pantallas < md la navegación y el cierre de sesión viven en el menú: se abre (no-op en escritorio). */
export async function abrirMenuSiMovil(page: Page) {
  const boton = page.getByRole('button', { name: 'Menú' });
  if (!(await boton.isVisible())) return;
  // Hasta hidratar, el clic no hace nada: se reintenta hasta ver el menú abierto.
  await expect(async () => {
    if ((await boton.getAttribute('aria-expanded')) !== 'true') await boton.click();
    await expect(boton).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
  }).toPass();
}

/**
 * Los formularios con `onSubmit` nacen con el botón deshabilitado y `data-hidratado="no"`; React los marca "si"
 * al hidratar. Hay que esperar antes de interactuar: un envío previo sería nativo (campos en la URL).
 */
export async function esperarHidratado(page: Page) {
  await page.waitForFunction(() => !document.querySelector('form[data-hidratado="no"]'));
}

/** `goto` seguido de la espera a la hidratación de los formularios de la página. */
export async function irA(page: Page, ruta: string) {
  await page.goto(ruta);
  await esperarHidratado(page);
}
