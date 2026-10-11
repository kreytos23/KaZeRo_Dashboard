import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Cada Server Action es un POST público: debe validar la sesión ella misma (spec §13), no confiar en la página.
const RAIZ = join(process.cwd(), 'src', 'app', 'panel');
// Cerrar sesión no necesita sesión válida: solo borra la cookie y revoca el token si existe.
const EXENTAS = new Set(['accionCerrarSesion']);

function archivosAcciones(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosAcciones(ruta);
    return nombre === 'acciones.ts' ? [ruta] : [];
  });
}

/** Devuelve nombre → cuerpo de cada `export async function`. */
function accionesExportadas(codigo: string): Map<string, string> {
  const partes = codigo.split(/^export async function /m).slice(1);
  return new Map(partes.map((p) => [p.slice(0, p.indexOf('(')), p]));
}

describe('Server Actions del panel', () => {
  const archivos = archivosAcciones(RAIZ);

  it('encuentra los archivos de acciones', () => {
    expect(archivos.length).toBeGreaterThanOrEqual(4);
  });

  for (const archivo of archivos) {
    const codigo = readFileSync(archivo, 'utf8');
    it(`${archivo.slice(RAIZ.length + 1)}: es 'use server' y no exporta nada que no sea async function`, () => {
      expect(codigo.trimStart().startsWith("'use server'")).toBe(true);
      expect(codigo).not.toMatch(/^export (const|let|var|class|function) /m);
    });
    for (const [nombre, cuerpo] of accionesExportadas(codigo)) {
      if (EXENTAS.has(nombre)) continue;
      it(`${archivo.slice(RAIZ.length + 1)}: ${nombre} llama requerirSesion() antes de tocar nada`, () => {
        const sesion = cuerpo.indexOf('await requerirSesion()');
        expect(sesion).toBeGreaterThan(-1);
        for (const otro of ['ejecutarAccion(', 'conDb(', 'FormData', 'fd.get', 'texto(']) {
          const i = cuerpo.indexOf(otro, cuerpo.indexOf('{'));
          if (i > -1) expect(sesion, `${otro} antes de requerirSesion`).toBeLessThan(i);
        }
      });
    }
  }
});
