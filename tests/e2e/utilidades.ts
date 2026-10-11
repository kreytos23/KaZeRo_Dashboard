import { expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generarCodigoTotp } from '../../src/server/auth/totp';

export const RUTA_DATOS = 'playwright/.datos/admin.json';
export const RUTA_ESTADO = 'playwright/.datos/estado.json';
export const RUTA_ESTADO_REGEN = 'playwright/.datos/estado-regen.json';
export const RUTA_DATOS_REGEN = 'playwright/.datos/admin-regen.json';
export const RUTA_PASO = 'playwright/.datos/ultimo-paso';

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
