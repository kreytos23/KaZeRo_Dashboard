import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Todo Route Handler bajo /api es privado salvo health: su primera sentencia valida la sesión (spec §13). */
const API = join(process.cwd(), 'src', 'app', 'api');
const PUBLICAS = new Set(['health/route.ts', 'health/listo/route.ts']);
const METODOS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? archivos(r) : n === 'route.ts' ? [r] : [];
  });
}

/** `if (!(await sesionDeApi())) …` o `const s = await sesionDeApi();` como PRIMERA sentencia. */
function primeraValidaSesion(st: ts.Statement | undefined): boolean {
  if (!st) return false;
  let llama = false;
  const buscar = (n: ts.Node) => {
    if (
      ts.isAwaitExpression(n) &&
      ts.isCallExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'sesionDeApi'
    )
      llama = true;
    ts.forEachChild(n, buscar);
  };
  if (ts.isIfStatement(st)) buscar(st.expression);
  else if (ts.isVariableStatement(st))
    st.declarationList.declarations.forEach((d) => d.initializer && buscar(d.initializer));
  return llama;
}

export function revisarRuta(codigo: string): string[] {
  const sf = ts.createSourceFile('route.ts', codigo, ts.ScriptTarget.Latest, true);
  const fallos: string[] = [];
  for (const st of sf.statements) {
    const exportada =
      ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportada) continue;
    if (ts.isFunctionDeclaration(st) && st.name && METODOS.has(st.name.text)) {
      if (!primeraValidaSesion(st.body?.statements[0]))
        fallos.push(`${st.name.text}: la primera sentencia debe validar sesionDeApi()`);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && METODOS.has(d.name.text))
          fallos.push(`${d.name.text}: declara el handler como función`);
    }
  }
  return fallos;
}

describe('guarda: Route Handlers privados validan la sesión', () => {
  it('todas las rutas de src/app/api (salvo health) cumplen', () => {
    const malas = archivos(API)
      .map((a) => ({ ruta: relative(API, a).replaceAll('\\', '/'), codigo: readFileSync(a, 'utf8') }))
      .filter(({ ruta }) => !PUBLICAS.has(ruta))
      .flatMap(({ ruta, codigo }) => revisarRuta(codigo).map((f) => `${ruta}: ${f}`));
    expect(malas).toEqual([]);
  });
  it('detecta un handler sin validación y uno exportado como constante', () => {
    expect(revisarRuta('export async function GET() { return Response.json({}); }')).toHaveLength(1);
    expect(revisarRuta('export const GET = async () => Response.json({});')).toHaveLength(1);
    expect(
      revisarRuta('export async function GET() { if (!(await sesionDeApi())) return x; return y; }'),
    ).toEqual([]);
  });
});
