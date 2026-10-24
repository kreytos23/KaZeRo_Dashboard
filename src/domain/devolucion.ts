/** D-15: reparte un descuento (centavos) proporcional a los precios, residuo mayor, desempate por índice. */
export function repartirDescuentoManual(precios: readonly number[], descuento: number): number[] {
  if (![...precios, descuento].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw new RangeError('Montos inválidos');
  const base = precios.reduce((a, b) => a + b, 0);
  if (descuento > base) throw new RangeError('El descuento supera la suma de las líneas');
  if (descuento === 0 || base === 0) return precios.map(() => 0);
  const exactos = precios.map((p) => BigInt(p) * BigInt(descuento));
  const partes = exactos.map((x) => Number(x / BigInt(base)));
  let falta = descuento - partes.reduce((a, b) => a + b, 0);
  const orden = exactos
    .map((x, i) => ({ i, resto: x % BigInt(base) }))
    .sort((a, b) => (b.resto > a.resto ? 1 : b.resto < a.resto ? -1 : a.i - b.i));
  for (const { i } of orden) {
    if (falta-- <= 0) break;
    partes[i]! += 1;
  }
  return partes;
}

/**
 * Lo pagado por una línea: precio_final − su parte del descuento manual (nunca más de lo cobrado).
 * `lineas` = todas las vigentes del pedido (también las ya devueltas), en orden estable por id.
 */
export function montoDevolucion(
  lineas: readonly { id: string; precioFinal: number }[],
  descuentoManual: number,
  lineaId: string,
): number {
  const i = lineas.findIndex((l) => l.id === lineaId);
  if (i < 0) throw new RangeError('La línea no es del pedido');
  return (
    lineas[i]!.precioFinal -
    repartirDescuentoManual(
      lineas.map((l) => l.precioFinal),
      descuentoManual,
    )[i]!
  );
}
