import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guarda ESTRICTA (spec §13): todo Route Handler bajo /api valida la sesión en su PRIMERA sentencia, salvo una
 * lista cerrada de excepciones. Es un análisis estático del AST: cualquier forma que no pueda verificar con
 * certeza (reexportaciones, `export default`, handlers como constantes, nombres sombreados) se rechaza.
 */
const API = join(process.cwd(), 'src', 'app', 'api');
const ES_RUTA = /^route\.(?:ts|tsx|js|jsx|mjs)$/;
const METODOS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
/** Únicas rutas sin sesión: health (público a propósito). */
const PUBLICAS = new Set(['health/route.ts', 'health/listo/route.ts']);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? archivos(r) : ES_RUTA.test(n) ? [r] : [];
  });
}

const sinParentesis = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ? sinParentesis(e.expression) : e;

/** `await <nombre>()` exacto: identificador simple, sin argumentos. */
function esAwaitLlamada(e: ts.Expression | undefined, nombre: string): boolean {
  if (!e) return false;
  const x = sinParentesis(e);
  if (!ts.isAwaitExpression(x)) return false;
  const c = sinParentesis(x.expression);
  return (
    ts.isCallExpression(c) &&
    ts.isIdentifier(c.expression) &&
    c.expression.text === nombre &&
    c.arguments.length === 0 &&
    !c.questionDotToken
  );
}

/** `if (<cond>) return …;` (o bloque que termina en `return <expr>`), sin `else`. */
function ifQueRetorna(st: ts.Statement | undefined): st is ts.IfStatement {
  if (!st || !ts.isIfStatement(st) || st.elseStatement) return false;
  const t = st.thenStatement;
  const ret = ts.isBlock(t) ? t.statements[t.statements.length - 1] : t;
  return !!ret && ts.isReturnStatement(ret) && !!ret.expression;
}

const negado = (e: ts.Expression): ts.Expression | null => {
  const x = sinParentesis(e);
  return ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.ExclamationToken ? x.operand : null;
};

/** `if (!(await sesionDeApi())) return …;` o `const s = await sesionDeApi();` + `if (!s) return …;`. */
function validaSesion(sts: readonly ts.Statement[]): boolean {
  const [a, b] = sts;
  if (ifQueRetorna(a)) {
    const op = negado(a.expression);
    return !!op && esAwaitLlamada(op, 'sesionDeApi');
  }
  if (a && ts.isVariableStatement(a)) {
    const lista = a.declarationList;
    if (!(lista.flags & ts.NodeFlags.Const) || lista.declarations.length !== 1) return false;
    const d = lista.declarations[0]!;
    if (!ts.isIdentifier(d.name) || !esAwaitLlamada(d.initializer, 'sesionDeApi')) return false;
    if (!ifQueRetorna(b)) return false;
    const op = negado(b.expression);
    if (!op) return false;
    const id = sinParentesis(op);
    return ts.isIdentifier(id) && id.text === d.name.text;
  }
  return false;
}

/** `if (!autorizarCron(…)) return …;` (sin await: es síncrona). */
function validaCron(sts: readonly ts.Statement[]): boolean {
  const [a] = sts;
  if (!ifQueRetorna(a)) return false;
  const op = negado(a.expression);
  if (!op) return false;
  const c = sinParentesis(op);
  return ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'autorizarCron';
}

type Guarda = 'sesion' | 'cron';
const GUARDAS: Record<Guarda, { nombre: string; modulo: string; valida: typeof validaSesion }> = {
  sesion: { nombre: 'sesionDeApi', modulo: '@/server/auth/sesion-actual', valida: validaSesion },
  cron: { nombre: 'autorizarCron', modulo: '@/server/seguridad/cron', valida: validaCron },
};

const tieneModificador = (st: ts.Statement, k: ts.SyntaxKind) =>
  ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === k);
const exportada = (st: ts.Statement) => tieneModificador(st, ts.SyntaxKind.ExportKeyword);
const esDefault = (st: ts.Statement) => tieneModificador(st, ts.SyntaxKind.DefaultKeyword);

function nombresEnPatron(n: ts.BindingName, salida: string[]) {
  if (ts.isIdentifier(n)) salida.push(n.text);
  else for (const el of n.elements) if (!ts.isOmittedExpression(el)) nombresEnPatron(el.name, salida);
}

/** Nombres que un statement top-level liga en el módulo (para detectar sombreado de la guarda). */
function ligados(st: ts.Statement): string[] {
  const r: string[] = [];
  if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach((d) => nombresEnPatron(d.name, r));
  else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name)
    r.push(st.name.text);
  else if (ts.isImportEqualsDeclaration(st)) r.push(st.name.text);
  else if (ts.isImportDeclaration(st) && st.importClause) {
    const c = st.importClause;
    if (c.name) r.push(c.name.text);
    const nb = c.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) r.push(nb.name.text);
    if (nb && ts.isNamedImports(nb)) nb.elements.forEach((e) => r.push(e.name.text));
  }
  return r;
}

export function revisarRuta(codigo: string, guarda: Guarda = 'sesion', nombreArchivo = 'route.ts'): string[] {
  const g = GUARDAS[guarda];
  const sf = ts.createSourceFile(nombreArchivo, codigo, ts.ScriptTarget.Latest, true);
  const fallos: string[] = [];

  // La guarda debe venir importada tal cual del módulo real y nadie más puede ligar ese nombre.
  const importadaBien = sf.statements.some(
    (st) =>
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === g.modulo &&
      !st.importClause?.isTypeOnly &&
      st.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(st.importClause.namedBindings) &&
      st.importClause.namedBindings.elements.some(
        (e) => e.name.text === g.nombre && !e.propertyName && !e.isTypeOnly,
      ),
  );
  const ligas = sf.statements.flatMap(ligados).filter((n) => n === g.nombre).length;
  const guardaValida = importadaBien && ligas === 1;

  for (const st of sf.statements) {
    if (ts.isExportAssignment(st)) {
      fallos.push('export default / export =: un Route Handler no se exporta así');
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      if (st.moduleSpecifier) {
        fallos.push('reexportación (export … from): no se puede verificar la guarda del handler');
      } else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements)
          if (METODOS.has(el.name.text) || (el.propertyName && METODOS.has(el.propertyName.text)))
            fallos.push(`${el.name.text}: exportado con export { … }; declara \`export async function\``);
      }
      continue;
    }
    if (!exportada(st)) continue;
    if (esDefault(st)) {
      fallos.push('export default: un Route Handler no se exporta así');
      continue;
    }
    if (ts.isFunctionDeclaration(st) && st.name && METODOS.has(st.name.text)) {
      const nombre = st.name.text;
      if (!st.body) fallos.push(`${nombre}: sobrecarga sin cuerpo`);
      else if (!guardaValida)
        fallos.push(`${nombre}: falta importar ${g.nombre} de ${g.modulo} (o el nombre está sombreado)`);
      else if (!g.valida(st.body.statements))
        fallos.push(`${nombre}: la primera sentencia debe ser la guarda ${g.nombre}()`);
      continue;
    }
    for (const n of ligados(st).filter((x) => METODOS.has(x)))
      fallos.push(`${n}: el handler debe ser \`export async function ${n}\``);
  }
  return fallos;
}

const rel = (a: string) => relative(API, a).replaceAll('\\', '/');

describe('guarda: Route Handlers privados validan la sesión', () => {
  it('hay rutas que revisar (la búsqueda de archivos no queda vacía)', () => {
    const todas = archivos(API).map(rel);
    expect(todas).toContain('health/route.ts');
    expect(todas).toContain('piezas/[id]/imagen/route.ts');
    expect(todas.length).toBeGreaterThanOrEqual(4);
  });
  it('la lista de excepciones es exactamente esta (agregar otra obliga a tocar esta prueba)', () => {
    expect([...PUBLICAS].sort()).toEqual(['health/listo/route.ts', 'health/route.ts']);
    const existentes = new Set(archivos(API).map(rel));
    for (const p of PUBLICAS) expect(existentes.has(p)).toBe(true);
  });
  it('todas las rutas de src/app/api (salvo la lista cerrada) cumplen', () => {
    const malas = archivos(API)
      .filter((a) => !PUBLICAS.has(rel(a)))
      .flatMap((a) => revisarRuta(readFileSync(a, 'utf8'), 'sesion', a).map((f) => `${rel(a)}: ${f}`));
    expect(malas).toEqual([]);
  });
});

const IMPORTA = `import { sesionDeApi } from '@/server/auth/sesion-actual';\n`;
const ok = (cuerpo: string) => `${IMPORTA}export async function GET() { ${cuerpo} }`;
const GUARDA = 'if (!(await sesionDeApi())) return x;';

describe('guarda estricta: autoprueba con fixtures', () => {
  it('acepta las formas permitidas', () => {
    expect(revisarRuta(ok(`${GUARDA} return y;`))).toEqual([]);
    expect(revisarRuta(ok('if (!(await sesionDeApi())) { log(); return x; } return y;'))).toEqual([]);
    expect(revisarRuta(ok('const s = await sesionDeApi(); if (!s) return x; return y;'))).toEqual([]);
    expect(
      revisarRuta(
        `${IMPORTA}export async function POST() { const s = await sesionDeApi();\n if (!s) { return x; } return y; }`,
      ),
    ).toEqual([]);
  });
  it.each([
    ['sin guarda', ok('return y;')],
    ['guarda en la segunda sentencia', ok(`log(); ${GUARDA} return y;`)],
    ['sin await (la promesa siempre es verdadera)', ok('if (!sesionDeApi()) return x; return y;')],
    ['llamada sin negar', ok('if (await sesionDeApi()) return x; return y;')],
    ['la condición no retorna', ok('if (!(await sesionDeApi())) log(); return y;')],
    ['retorna vacío', ok('if (!(await sesionDeApi())) return; return y;')],
    ['con else', ok('if (!(await sesionDeApi())) return x; else log(); return y;')],
    ['if con otra condición', ok('if (!(await sesionDeApi()) && flag) return x; return y;')],
    ['llamada con argumentos', ok('if (!(await sesionDeApi(1))) return x; return y;')],
    ['llamada opcional', ok('if (!(await sesionDeApi?.())) return x; return y;')],
    ['const sin comprobar', ok('const s = await sesionDeApi(); return y;')],
    ['const comprobada con otro nombre', ok('const s = await sesionDeApi(); if (!t) return x; return y;')],
    [
      'const sin comprobar inmediatamente',
      ok('const s = await sesionDeApi(); log(); if (!s) return x; return y;'),
    ],
    ['let en lugar de const', ok('let s = await sesionDeApi(); if (!s) return x; return y;')],
    ['sin await en la const', ok('const s = sesionDeApi(); if (!s) return x; return y;')],
    [
      'sobrecarga sin cuerpo',
      `${IMPORTA}export function GET(): Response;\nexport async function GET() { return y; }`,
    ],
  ])('rechaza: %s', (_n, codigo) => {
    expect(revisarRuta(codigo).length).toBeGreaterThan(0);
  });
  it.each([
    ['handler como constante', `${IMPORTA}export const GET = async () => Response.json({});`],
    [
      'handler como constante con guarda',
      `${IMPORTA}export const GET = async () => { ${GUARDA} return y; };`,
    ],
    ['desestructurado', `${IMPORTA}export const { GET } = otros;`],
    ['reexportación', `export { GET } from './otro';`],
    ['reexportación con alias', `export { h as GET } from './otro';`],
    ['reexportación total', `export * from './otro';`],
    ['export local con alias', `async function h() { return y; }\nexport { h as POST };`],
    ['export local con nombre', `${IMPORTA}async function GET() { ${GUARDA} return y; }\nexport { GET };`],
    ['export con nombre literal', `async function h() { return y; }\nexport { h as "DELETE" };`],
    ['export default función', `export default async function GET() { return y; }`],
    ['export default identificador', `async function GET() { return y; }\nexport default GET;`],
    ['export =', `async function GET() { return y; }\nexport = GET;`],
    ['clase exportada con nombre de método', `export class GET {}`],
    ['sesionDeApi sin importar', `export async function GET() { ${GUARDA} return y; }`],
    [
      'sesionDeApi importada de otro módulo',
      `import { sesionDeApi } from './falsa';\nexport async function GET() { ${GUARDA} return y; }`,
    ],
    [
      'sesionDeApi importada con alias',
      `import { otra as sesionDeApi } from '@/server/auth/sesion-actual';\nexport async function GET() { ${GUARDA} return y; }`,
    ],
    [
      'sesionDeApi redefinida localmente',
      `${IMPORTA}const sesionDeApi = async () => true;\nexport async function GET() { ${GUARDA} return y; }`,
    ],
  ])('rechaza: %s', (_n, codigo) => {
    expect(revisarRuta(codigo).length).toBeGreaterThan(0);
  });
  it('analiza también .tsx, .js, .jsx y .mjs', () => {
    for (const ext of ['tsx', 'js', 'jsx', 'mjs'])
      expect(revisarRuta('export async function GET() { return y; }', 'sesion', `route.${ext}`)).toHaveLength(
        1,
      );
    expect(ES_RUTA.test('route.mjs')).toBe(true);
    expect(ES_RUTA.test('route.tsx')).toBe(true);
    expect(ES_RUTA.test('route.test.ts')).toBe(false);
  });
});
