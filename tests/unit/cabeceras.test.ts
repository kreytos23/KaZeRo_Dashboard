import { describe, expect, it } from 'vitest';
import { cabecerasEstaticas, construirCsp } from '@/server/seguridad/cabeceras';

describe('construirCsp', () => {
  const csp = construirCsp('NONCE123', false);
  it('usa nonce + strict-dynamic para scripts y nada inline', () => {
    expect(csp).toContain("script-src 'self' 'nonce-NONCE123' 'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
  it('prohíbe embeber el sitio y plugins', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
  });
  it('en desarrollo permite eval y websockets para recarga en caliente', () => {
    const dev = construirCsp('N', true);
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain('ws:');
  });
});

describe('cabecerasEstaticas', () => {
  const mapa = Object.fromEntries(cabecerasEstaticas().map((c) => [c.key, c.value]));
  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Robots-Tag', 'noindex, nofollow'],
  ])('%s = %s', (k, v) => expect(mapa[k]).toBe(v));
  it('HSTS de 2 años', () => expect(mapa['Strict-Transport-Security']).toMatch(/max-age=63072000/));
  it('Permissions-Policy niega cámara (se abre en fase 2) y micrófono', () => {
    expect(mapa['Permissions-Policy']).toContain('camera=()');
    expect(mapa['Permissions-Policy']).toContain('microphone=()');
  });
});
