const SQLSTATE = /^[0-9A-Z]{5}$/;

function buscarEnCadena(err: unknown, campo: 'code' | 'constraint', valido: (v: string) => boolean) {
  const vistos = new Set<unknown>();
  let actual: unknown = err;
  while (actual !== null && typeof actual === 'object' && !vistos.has(actual)) {
    vistos.add(actual);
    const valor = (actual as Record<string, unknown>)[campo];
    if (typeof valor === 'string' && valido(valor)) return valor;
    actual = (actual as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Código SQLSTATE de Postgres aunque el ORM lo haya envuelto en varios `cause`. */
export function pgCode(err: unknown): string | undefined {
  return buscarEnCadena(err, 'code', (v) => SQLSTATE.test(v));
}

/** Nombre de la constraint violada, recorriendo la cadena de `cause`. */
export function pgConstraint(err: unknown): string | undefined {
  return buscarEnCadena(err, 'constraint', (v) => v.length > 0);
}
