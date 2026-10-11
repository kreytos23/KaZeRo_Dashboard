import { describe, expect, it } from 'vitest';
import { config } from '@/proxy';

// Next compila el matcher como una expresión que cubre toda la ruta.
const cubre = (ruta: string) => new RegExp(`^${config.matcher[0]}$`).test(ruta);

describe('matcher del proxy', () => {
  it('excluye solo los estáticos exactos', () => {
    expect(cubre('/_next/static/chunks/a.js')).toBe(false);
    expect(cubre('/_next/image')).toBe(false);
    expect(cubre('/_next/image/x')).toBe(false);
    expect(cubre('/favicon.ico')).toBe(false);
  });
  it('lo demás pasa por el proxy (cabeceras de seguridad y CSP), incluidas variantes parecidas', () => {
    for (const ruta of [
      '/',
      '/panel',
      '/no-existe',
      '/favicon.icoX',
      '/favicon.ico/x',
      '/_next/staticx',
      '/_next/imagex',
      '/icon.png',
      '/apple-icon.png',
      '/marca/logo-k.webp',
    ])
      expect(cubre(ruta), ruta).toBe(true);
  });
});
