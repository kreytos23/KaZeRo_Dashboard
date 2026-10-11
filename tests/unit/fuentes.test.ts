import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// El build no debe depender de que Google Fonts responda: las fuentes viven en el repo (next/font/local).
const SRC = join(process.cwd(), 'src');
const FUENTES = join(SRC, 'app', 'fonts');

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx|css)$/.test(n) ? [p] : [];
  });
}

describe('fuentes autoalojadas (build hermético)', () => {
  it('nada en src/ importa next/font/google', () => {
    const conGoogle = archivos(SRC).filter((p) => readFileSync(p, 'utf8').includes('next/font/google'));
    expect(conGoogle).toEqual([]);
  });

  it('la fuente está en el repo como woff2 válido, con su licencia OFL', () => {
    const woff2 = existsSync(FUENTES) ? readdirSync(FUENTES).filter((n) => n.endsWith('.woff2')) : [];
    expect(woff2.length).toBeGreaterThan(0);
    for (const n of woff2)
      expect(readFileSync(join(FUENTES, n)).subarray(0, 4).toString('latin1')).toBe('wOF2');
    const licencia = readFileSync(join(FUENTES, 'OFL.txt'), 'utf8');
    expect(licencia).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(licencia).toContain('Nunito Sans');
  });
});
