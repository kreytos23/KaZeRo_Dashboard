import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Páginas, layouts y Route Handlers GET solo leen: usan `conDbLectura` (reintenta una vez si falla la
 * conexión). `conDb` sin reintento queda para Server Actions y escrituras.
 */
const APP = join(process.cwd(), 'src', 'app');
// Readiness reporta el estado real de la BD: un reintento ocultaría la falla.
const EXENTOS = new Set(['api/health/listo/route.ts']);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}

/** Rutas (relativas a src/app) de lectura que todavía llaman a `conDb(`. */
function lecturasSinReintento(fuentes: { ruta: string; codigo: string }[]): string[] {
  return fuentes
    .filter(({ ruta }) => /(^|\/)(page|layout)\.tsx$|(^|\/)route\.ts$/.test(ruta) && !EXENTOS.has(ruta))
    .filter(({ codigo }) => /\bconDb\s*\(/.test(codigo))
    .map(({ ruta }) => ruta);
}

describe('lecturas de páginas con reintento', () => {
  it('ninguna página/layout/route usa conDb directamente', () => {
    const fuentes = archivos(APP).map((p) => ({
      ruta: relative(APP, p).split(sep).join('/'),
      codigo: readFileSync(p, 'utf8'),
    }));
    expect(fuentes.length).toBeGreaterThan(10);
    expect(lecturasSinReintento(fuentes)).toEqual([]);
  });

  it('autoprueba: detecta conDb( en una página y respeta conDbLectura y los exentos', () => {
    expect(
      lecturasSinReintento([
        { ruta: 'panel/x/page.tsx', codigo: 'await conDb((db) => f(db))' },
        { ruta: 'panel/y/page.tsx', codigo: 'await conDbLectura((db) => f(db))' },
        { ruta: 'panel/x/acciones.ts', codigo: 'await conDb((db) => f(db))' },
        { ruta: 'api/health/listo/route.ts', codigo: 'await conDb((db) => f(db))' },
      ]),
    ).toEqual(['panel/x/page.tsx']);
  });
});
