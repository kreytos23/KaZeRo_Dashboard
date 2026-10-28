/** R-33: el pago de una vendedora se reparte del pedido más viejo al más nuevo (fecha y luego folio). */
export function repartoSugerido(
  montoCentavos: number,
  pedidos: { id: string; fecha: string; folio: number; saldoCentavos: number }[],
): { aplicaciones: { pedidoId: string; montoCentavos: number }[]; sobranteCentavos: number } {
  let resto = montoCentavos;
  const aplicaciones: { pedidoId: string; montoCentavos: number }[] = [];
  const orden = [...pedidos].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.folio - b.folio);
  for (const p of orden) {
    const monto = Math.min(p.saldoCentavos, resto);
    if (monto <= 0) continue;
    aplicaciones.push({ pedidoId: p.id, montoCentavos: monto });
    resto -= monto;
  }
  return { aplicaciones, sobranteCentavos: resto };
}
