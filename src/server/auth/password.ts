import { hash, verify } from '@node-rs/argon2';

// algorithm 2 = Argon2id (el enum de la librería es `const enum` y no funciona con isolatedModules).
// Parámetros mínimos recomendados por OWASP para Argon2id.
const OPCIONES = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_LONGITUD = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPCIONES);
}

export async function verificarPassword(hashGuardado: string, password: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, password);
  } catch {
    return false;
  }
}

export function validarFortaleza(password: string): string | null {
  return password.length < MIN_LONGITUD
    ? `La contraseña debe tener al menos ${MIN_LONGITUD} caracteres.`
    : null;
}
