import { Secret, TOTP } from 'otpauth';

const PERIODO = 30;

function crear(secreto: string, etiqueta = 'admin') {
  return new TOTP({
    issuer: 'Kazero',
    label: etiqueta,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIODO,
    secret: Secret.fromBase32(secreto),
  });
}

export function nuevoSecretoTotp(): string {
  return new Secret({ size: 20 }).base32;
}

export function uriTotp(secreto: string, email: string): string {
  return crear(secreto, email).toString();
}

/** Devuelve el paso (timestamp/30s) del código si es válido con ±1 paso de tolerancia; si no, null. */
export function pasoTotpValido(secreto: string, codigo: string, ahora = new Date()): number | null {
  const delta = crear(secreto).validate({ token: codigo, timestamp: ahora.getTime(), window: 1 });
  return delta === null ? null : Math.floor(ahora.getTime() / (PERIODO * 1000)) + delta;
}

export function generarCodigoTotp(secreto: string, ahora = new Date()): string {
  return crear(secreto).generate({ timestamp: ahora.getTime() });
}
