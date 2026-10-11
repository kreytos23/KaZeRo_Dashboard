import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Cada Server Action es un POST público (spec §13): debe validar la sesión ella misma.
 * Esta guarda recorre todo `src/` y falla ante cualquier forma de saltársela.
 */
const SRC = join(process.cwd(), 'src');

// Únicos archivos que pueden ser 'use server'.
const PERMITIDOS = [/^app\/login\/acciones\.ts$/, /^app\/panel(\/.+)?\/acciones\.ts$/];
// Acciones que no exigen sesión por diseño: el login aún no la tiene y cerrar sesión solo borra la cookie.
// Cada exenta vale SOLO en su archivo: el mismo nombre en otro acciones.ts pasa por la guarda.
const EXENTAS: Readonly<Record<string, readonly string[]>> = {
  'app/login/acciones.ts': ['accionLogin', 'accionVerificar'],
  'app/panel/acciones.ts': ['accionCerrarSesion'],
};

function esDirectiva(n: ts.Node): boolean {
  return (
    ts.isExpressionStatement(n) && ts.isStringLiteral(n.expression) && n.expression.text === 'use server'
  );
}

/** Devuelve las violaciones de un archivo de acciones (vacío = correcto). */
function revisarAcciones(codigo: string, ruta = ''): string[] {
  const exentas = new Set(EXENTAS[ruta] ?? []);
  const sf = ts.createSourceFile('acciones.ts', codigo, ts.ScriptTarget.Latest, true);
  const fallos: string[] = [];

  if (!sf.statements[0] || !esDirectiva(sf.statements[0]))
    fallos.push("'use server' no es la primera sentencia");

  const visitar = (n: ts.Node) => {
    if (esDirectiva(n) && n !== sf.statements[0])
      fallos.push("'use server' fuera de la cabecera del archivo");
    ts.forEachChild(n, visitar);
  };
  visitar(sf);

  for (const st of sf.statements) {
    if (ts.isExportAssignment(st)) fallos.push('export default / export =');
    else if (ts.isExportDeclaration(st) && !st.isTypeOnly) fallos.push('export { … } / export * from');
    else if (ts.isVariableStatement(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      fallos.push('export const/let/var (una acción debe ser una función async declarada)');
    else if (ts.isClassDeclaration(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      fallos.push('export class');
    else if (
      ts.isFunctionDeclaration(st) &&
      st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const nombre = st.name?.text ?? '(anónima)';
      if (st.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
        fallos.push('export default function');
      if (!st.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword))
        fallos.push(`${nombre}: la acción exportada no es async`);
      if (st.asteriskToken) fallos.push(`${nombre}: generador async`);
      if (exentas.has(nombre)) continue;
      const primera = st.body?.statements[0];
      if (!primera || !llamaRequerirSesion(primera))
        fallos.push(`${nombre}: la primera sentencia debe ser await requerirSesion()`);
    }
  }
  return fallos;
}

/** `await requerirSesion();` o `const x = await requerirSesion();` como sentencia real (no comentario). */
function llamaRequerirSesion(st: ts.Statement): boolean {
  const esLlamada = (e: ts.Expression | undefined): boolean =>
    !!e &&
    ts.isAwaitExpression(e) &&
    ts.isCallExpression(e.expression) &&
    ts.isIdentifier(e.expression.expression) &&
    e.expression.expression.text === 'requerirSesion';
  if (ts.isExpressionStatement(st)) return esLlamada(st.expression);
  if (ts.isVariableStatement(st))
    return (
      st.declarationList.declarations.length === 1 &&
      esLlamada(st.declarationList.declarations[0]!.initializer)
    );
  return false;
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory()
      ? archivos(ruta)
      : /\.(ts|tsx|js|jsx|mjs)$/.test(nombre)
        ? [ruta]
        : [];
  });
}

describe('guarda de Server Actions (todo src/)', () => {
  const todos = archivos(SRC).map((ruta) => ({
    rel: relative(SRC, ruta).replaceAll('\\', '/'),
    codigo: readFileSync(ruta, 'utf8'),
  }));
  const conUseServer = todos.filter((a) => /['"]use server['"]/.test(a.codigo));

  it('hay archivos de acciones', () => {
    expect(conUseServer.length).toBeGreaterThanOrEqual(5);
  });

  it("'use server' solo aparece en archivos permitidos", () => {
    const ajenos = conUseServer.filter((a) => !PERMITIDOS.some((p) => p.test(a.rel))).map((a) => a.rel);
    expect(ajenos).toEqual([]);
  });

  it('todo acciones.ts de las rutas privadas declara su directiva', () => {
    const sinDirectiva = todos
      .filter((a) => PERMITIDOS.some((p) => p.test(a.rel)) && !conUseServer.includes(a))
      .map((a) => a.rel);
    expect(sinDirectiva).toEqual([]);
  });

  for (const a of conUseServer) {
    it(`${a.rel}: cumple la guarda`, () => {
      expect(revisarAcciones(a.codigo, a.rel)).toEqual([]);
    });
  }
});

describe('la guarda detecta cada forma de saltársela', () => {
  const ok = `'use server';
import { requerirSesion } from '@/x';
export async function accionA(_: E, fd: FormData) {
  await requerirSesion();
  return 1;
}
export async function accionB({ a }: { a: string }, [b]: string[]) {
  const s = await requerirSesion();
  return s;
}
export type T = string;`;
  const con = (cuerpo: string) => `'use server';\n${cuerpo}`;

  it('acepta una acción correcta, incluso con parámetros desestructurados', () => {
    expect(revisarAcciones(ok)).toEqual([]);
  });
  it('rechaza una acción exportada como arrow function', () => {
    expect(
      revisarAcciones(con('export const accionX = async () => { await requerirSesion(); };')),
    ).not.toEqual([]);
  });
  it('rechaza export default', () => {
    expect(
      revisarAcciones(con('export default async function () { await requerirSesion(); }')).length,
    ).toBeGreaterThan(0);
    expect(revisarAcciones(con('async function f() {}\nexport default f;'))).not.toEqual([]);
  });
  it('rechaza re-exportaciones', () => {
    expect(revisarAcciones(con("export { x } from './otro';"))).not.toEqual([]);
    expect(revisarAcciones(con("export * from './otro';"))).not.toEqual([]);
  });
  it("rechaza 'use server' a nivel de función", () => {
    const codigo = `'use server';\nexport async function accionA() {\n  await requerirSesion();\n}\nfunction f() {\n  'use server';\n}`;
    expect(revisarAcciones(codigo)).not.toEqual([]);
    expect(
      revisarAcciones(`export async function a() {\n  'use server';\n  await requerirSesion();\n}`),
    ).not.toEqual([]);
  });
  it('rechaza requerirSesion solo en un comentario o en una cadena', () => {
    expect(
      revisarAcciones(con('export async function a() {\n  // await requerirSesion();\n  return 1;\n}')),
    ).not.toEqual([]);
    expect(
      revisarAcciones(
        con("export async function a() {\n  const s = 'await requerirSesion()';\n  return s;\n}"),
      ),
    ).not.toEqual([]);
  });
  it('rechaza requerirSesion que no es la primera sentencia', () => {
    expect(
      revisarAcciones(
        con(
          'export async function a(fd: FormData) {\n  const x = fd.get("a");\n  await requerirSesion();\n}',
        ),
      ),
    ).not.toEqual([]);
  });
  it('rechaza generadores y funciones no async', () => {
    expect(revisarAcciones(con('export async function* a() { await requerirSesion(); }'))).not.toEqual([]);
    expect(revisarAcciones(con('export function a() { return 1; }'))).not.toEqual([]);
  });
  it('las exentas solo valen en su propio archivo', () => {
    const cerrar = con('export async function accionCerrarSesion() { return 1; }');
    const login = con('export async function accionLogin() { return 1; }');
    expect(revisarAcciones(cerrar, 'app/panel/acciones.ts')).toEqual([]);
    expect(revisarAcciones(login, 'app/login/acciones.ts')).toEqual([]);
    // El mismo nombre en otro archivo de acciones ya no se salta la guarda.
    expect(revisarAcciones(cerrar, 'app/panel/clientes/acciones.ts')).not.toEqual([]);
    expect(revisarAcciones(login, 'app/panel/acciones.ts')).not.toEqual([]);
    expect(revisarAcciones(cerrar, 'app/login/acciones.ts')).not.toEqual([]);
    expect(
      revisarAcciones(con('export async function accionOtra() { return 1; }'), 'app/login/acciones.ts'),
    ).not.toEqual([]);
  });
});
