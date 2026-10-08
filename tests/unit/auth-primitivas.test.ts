import { describe, expect, it } from 'vitest';
import { cifrar, descifrar } from '@/server/auth/cifrado';
import { hashPassword, validarFortaleza, verificarPassword } from '@/server/auth/password';
import {
  hashCodigoRecuperacion,
  hashToken,
  nuevoToken,
  nuevosCodigosRecuperacion,
} from '@/server/auth/tokens';
import { generarCodigoTotp, nuevoSecretoTotp, pasoTotpValido, uriTotp } from '@/server/auth/totp';

const llave = Buffer.alloc(32, 9).toString('base64');

describe('password', () => {
  it('verifica la correcta y rechaza la incorrecta', async () => {
    const h = await hashPassword('correcta-larga-123');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verificarPassword(h, 'correcta-larga-123')).toBe(true);
    expect(await verificarPassword(h, 'otra')).toBe(false);
  });
  it('un hash corrupto devuelve false en vez de lanzar', async () => {
    expect(await verificarPassword('basura', 'x')).toBe(false);
  });
  it('exige mínimo 12 caracteres', () => {
    expect(validarFortaleza('corta')).toMatch(/12/);
    expect(validarFortaleza('suficientemente-larga')).toBeNull();
  });
});

describe('TOTP', () => {
  const secreto = nuevoSecretoTotp();
  const t = new Date('2026-10-08T12:00:15Z');

  it('acepta el código actual y devuelve su paso', () => {
    expect(pasoTotpValido(secreto, generarCodigoTotp(secreto, t), t)).toBe(Math.floor(t.getTime() / 30_000));
  });
  it('acepta el código del paso anterior (tolerancia de reloj) con su paso real', () => {
    const antes = new Date(t.getTime() - 30_000);
    expect(pasoTotpValido(secreto, generarCodigoTotp(secreto, antes), t)).toBe(
      Math.floor(antes.getTime() / 30_000),
    );
  });
  it('rechaza un código de hace 2 minutos', () => {
    const viejo = new Date(t.getTime() - 120_000);
    expect(pasoTotpValido(secreto, generarCodigoTotp(secreto, viejo), t)).toBeNull();
  });
  it('la URI otpauth lleva emisor Kazero', () => {
    expect(uriTotp(secreto, 'a@b.mx')).toMatch(/^otpauth:\/\/totp\/Kazero:a%40b\.mx\?.*issuer=Kazero/);
  });
});

describe('cifrado AES-256-GCM', () => {
  it('ida y vuelta', () => {
    expect(descifrar(cifrar('JBSWY3DPEHPK3PXP', llave), llave)).toBe('JBSWY3DPEHPK3PXP');
  });
  it('dos cifrados del mismo texto difieren (IV aleatorio)', () => {
    expect(cifrar('x', llave)).not.toBe(cifrar('x', llave));
  });
  it('detecta manipulación', () => {
    const p = cifrar('secreto', llave).split('.');
    p[3] = Buffer.from('otro').toString('base64url');
    expect(() => descifrar(p.join('.'), llave)).toThrow();
  });
  it('rechaza llaves que no son de 32 bytes', () => {
    expect(() => cifrar('x', Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('tokens', () => {
  it('genera token de 256 bits y guarda solo su hash', () => {
    const { token, hash } = nuevoToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('códigos de recuperación: 8, formato XXXXX-XXXXX, hash insensible a guion y mayúsculas', () => {
    const c = nuevosCodigosRecuperacion();
    expect(c).toHaveLength(8);
    expect(new Set(c).size).toBe(8);
    for (const x of c) expect(x).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    const primero = c[0]!;
    expect(hashCodigoRecuperacion(primero.toLowerCase().replace('-', ' '))).toBe(
      hashCodigoRecuperacion(primero),
    );
  });
});
