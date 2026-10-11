import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Prueba estática: Chrome no se puede automatizar con contraseñas guardadas, así que las garantías
// contra cruces de autocompletado (correo en campo de contraseña y viceversa) salen de la semántica.

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

type Control = { tag: string; type?: string; autocomplete?: string };

/** Controles `<input>` y `<Campo>` en orden de aparición, agrupados por `<form`. */
function formularios(codigo: string): Control[][] {
  return codigo
    .split(/<form\b/)
    .slice(1)
    .map((trozo) => {
      const fin = trozo.indexOf('</form>');
      const cuerpo = fin < 0 ? trozo : trozo.slice(0, fin);
      const tags = cuerpo.match(/<(?:input|Campo|UsuarioActual)\b(?:[^>{}]|\{[^}]*\})*>/g) ?? [];
      return tags.map((t) => ({
        tag: t,
        type: /\btype="([^"]+)"/.exec(t)?.[1],
        // <UsuarioActual> renderiza el input oculto con autoComplete="username" (ver FormsAdmin).
        autocomplete: t.startsWith('<UsuarioActual') ? 'username' : /\bautoComplete="([^"]+)"/.exec(t)?.[1],
      }));
    });
}

const todos = archivos('src').flatMap((f) =>
  formularios(readFileSync(f, 'utf8')).map((controles) => ({ f, controles })),
);

describe('autocompletado de credenciales', () => {
  it('encuentra los formularios con contraseña', () => {
    expect(todos.filter((x) => x.controles.some((c) => c.type === 'password')).length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('todo input de contraseña declara current-password o new-password', () => {
    for (const { f, controles } of todos)
      for (const c of controles.filter((c) => c.type === 'password'))
        expect(['current-password', 'new-password'], `${f}: ${c.tag}`).toContain(c.autocomplete);
  });

  it('todo formulario con current-password tiene un único username antes de ella', () => {
    for (const { f, controles } of todos) {
      const i = controles.findIndex((c) => c.autocomplete === 'current-password');
      if (i < 0) continue;
      const usuarios = controles.filter((c) => c.autocomplete === 'username');
      expect(usuarios, f).toHaveLength(1);
      expect(controles.indexOf(usuarios[0]!), f).toBeLessThan(i);
    }
  });

  it('ningún correo del formulario de administradores usa username ni email', () => {
    const admin = todos.filter((x) => x.f.includes('administradores'));
    expect(admin.length).toBeGreaterThan(0);
    for (const { f, controles } of admin)
      for (const c of controles.filter((c) => c.type === 'email'))
        expect(['username', 'email'], `${f}: ${c.tag}`).not.toContain(c.autocomplete);
  });
});
