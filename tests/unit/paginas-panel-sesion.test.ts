import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return paginas(ruta);
    return nombre === 'page.tsx' ? [ruta] : [];
  });
}

describe('páginas del panel', () => {
  it('toda página que lee datos valida la sesión (el layout no se vuelve a renderizar en la navegación)', () => {
    const lista = paginas(join(process.cwd(), 'src', 'app', 'panel'));
    expect(lista.length).toBeGreaterThan(0);
    const sinSesion = lista.filter((f) => {
      const t = readFileSync(f, 'utf8');
      return t.includes('conDbLectura') && !t.includes('requerirSesion');
    });
    expect(sinSesion).toEqual([]);
  });
});
