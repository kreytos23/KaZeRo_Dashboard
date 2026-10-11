const PATRON_CODIGO = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
const PATRON_PREFIJO = /^[A-Z]{1,6}$/;

export function normalizarCodigo(c: string): string {
  return c.trim().toUpperCase().replace(/\s+/g, '');
}

export function esCodigoValido(c: string): boolean {
  return PATRON_CODIGO.test(c);
}

export function esPrefijoValido(p: string): boolean {
  return PATRON_PREFIJO.test(p);
}

export function separarCodigo(c: string): { prefijo: string; numero: number; ancho: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(c);
  if (!m) return null;
  return { prefijo: m[1]!, numero: Number(m[2]), ancho: m[2]!.length };
}

/** R-01: siguiente número del prefijo, con el ancho más grande ya usado (mínimo 2): AI29 → AI30, AN100 → AN101. */
export function siguienteCodigo(prefijo: string, existentes: readonly string[]): string {
  const p = normalizarCodigo(prefijo);
  let max = 0;
  let ancho = 2;
  for (const c of existentes) {
    const s = separarCodigo(normalizarCodigo(c));
    if (!s || s.prefijo !== p) continue;
    max = Math.max(max, s.numero);
    ancho = Math.max(ancho, s.ancho);
  }
  return p + String(max + 1).padStart(ancho, '0');
}
