// El dinero se maneja en centavos enteros: nunca flotantes (0.1 + 0.2 ≠ 0.3).

export function pesosACentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/^\$\s*/, '');
  // Comas solo como separador de miles bien formado (1,234,567.89); '1,2' NO es un monto.
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(limpio)) return null;
  const [entero, decimales = ''] = limpio.replace(/,/g, '').split('.');
  if (entero!.length > 9) return null;
  return Number(entero) * 100 + Number(decimales.padEnd(2, '0'));
}

/** Montos de negocio: nunca negativos (las validaciones de piezas, pagos y pedidos se apoyan en este RangeError). */
export function centavosANumeric(c: number): string {
  if (!Number.isSafeInteger(c) || c < 0) throw new RangeError('Monto en centavos inválido.');
  return `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

/** Solo para movimientos que llevan signo (ajustes del exhibidor). */
export function centavosANumericConSigno(c: number): string {
  return c < 0 ? `-${centavosANumeric(-c)}` : centavosANumeric(c);
}

export function numericACentavos(n: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(n);
  if (!m) throw new RangeError('Valor numeric inválido.');
  const c = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(c)) throw new RangeError('Valor numeric fuera de rango.');
  return m[1] && c ? -c : c;
}

const FORMATO = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

export function formatoMXN(c: number): string {
  return FORMATO.format(c / 100);
}

/** "20.00" → "20", "12.50" → "12.5": para mostrar un porcentaje guardado como numeric(5,2) en un campo. */
export function porcentajeLegible(numeric: string): string {
  return /^\d+\.\d+$/.test(numeric) ? numeric.replace(/0+$/, '').replace(/\.$/, '') : numeric;
}

/** Comisión: 0 a 100 con hasta 2 decimales, devuelta como numeric(5,2). */
export function porcentajeANumeric(texto: string): string | null {
  let t = texto.trim().replace(/%$/, '').trim();
  // Coma decimal ("12,5"): una sola coma con 1-2 decimales no es ambigua con separador de miles.
  if (/^\d{1,3},\d{1,2}$/.test(t)) t = t.replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const valor = Number(t);
  return valor > 100 ? null : valor.toFixed(2);
}
