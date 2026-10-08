import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generarCodigoTotp } from '../../src/server/auth/totp';

export const RUTA_DATOS = 'playwright/.datos/admin.json';
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
  return generarCodigoTotp(secreto);
}
