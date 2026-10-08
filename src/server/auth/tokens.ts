import { createHash, randomBytes, randomInt } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function nuevoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function nuevosCodigosRecuperacion(n = 8): string[] {
  const codigos = new Set<string>();
  while (codigos.size < n) {
    const c = Array.from({ length: 10 }, () => BASE32[randomInt(32)]).join('');
    codigos.add(`${c.slice(0, 5)}-${c.slice(5)}`);
  }
  return [...codigos];
}

/** 50 bits aleatorios por código: SHA-256 basta, no hace falta un hash lento. */
export function hashCodigoRecuperacion(codigo: string): string {
  return hashToken(codigo.toUpperCase().replace(/[^A-Z2-7]/g, ''));
}
