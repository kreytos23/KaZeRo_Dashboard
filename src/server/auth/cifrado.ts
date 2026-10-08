import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function llave(llaveB64: string): Buffer {
  const k = Buffer.from(llaveB64, 'base64');
  if (k.length !== 32) throw new Error('La llave de cifrado debe ser de 32 bytes (base64).');
  return k;
}

/** Formato: v1.<iv>.<tag>.<ciphertext>, todo en base64url. */
export function cifrar(texto: string, llaveB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', llave(llaveB64), iv);
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    c.getAuthTag().toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
}

export function descifrar(paquete: string, llaveB64: string): string {
  const [version, iv, tag, ct] = paquete.split('.');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Paquete cifrado con formato desconocido.');
  const d = createDecipheriv('aes-256-gcm', llave(llaveB64), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
