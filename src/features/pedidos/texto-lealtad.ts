import type { Casilla } from '@/domain/lealtad';
import { formatoFolio, formatoPct, numericAPctBps } from '@/domain/pedidos';
import type { TarjetaPrevia } from './tipos';

/** Una sola fuente para los textos de lealtad de la vista previa, la ficha y la tarjeta (E2E depende de ellos). */
export function textoLealtadPrevia(
  t: TarjetaPrevia | null,
  o: { cuentaTarjeta: boolean; hayCliente: boolean },
): string {
  if (!o.cuentaTarjeta) return 'No cuenta para la tarjeta de lealtad.';
  if (!o.hayCliente || !t) return 'Elige un cliente para ver su tarjeta.';
  const quien = `Pedido ${t.posicion} de su tarjeta${t.ciclo > 1 ? ` (ciclo ${t.ciclo})` : ''}`;
  if (t.sinLealtad === 'saldo_pendiente')
    return `${quien}: sin descuento porque tiene saldo pendiente en ${t.foliosConSaldo.map(formatoFolio).join(', ')}.`;
  return t.pctBps > 0 ? `${quien}: −${formatoPct(t.pctBps)}` : `${quien}.`;
}

export function textoLealtadGuardada(p: {
  cuentaTarjeta: boolean;
  cicloTarjeta: number | null;
  posicionTarjeta: number | null;
  descuentoLealtadPct: string;
  sinLealtadMotivo: 'saldo_pendiente' | null;
}): string {
  if (!p.cuentaTarjeta || p.posicionTarjeta === null) return 'No cuenta para la tarjeta de lealtad.';
  const donde = `Posición ${p.posicionTarjeta} del ciclo ${p.cicloTarjeta}`;
  if (p.sinLealtadMotivo === 'saldo_pendiente')
    return `${donde}: sin descuento porque al crearlo tenía otra nota con saldo pendiente.`;
  const bps = numericAPctBps(p.descuentoLealtadPct);
  return bps > 0 ? `${donde}: −${formatoPct(bps)}` : `${donde}.`;
}

export function etiquetaCasilla(c: Casilla): string {
  const partes = [`Posición ${c.posicion}: ${c.estado}`];
  if (c.folio !== null) partes.push(formatoFolio(c.folio));
  if (c.pctBps > 0) partes.push(`${formatoPct(c.pctBps)} de descuento`);
  return partes.join(', ');
}
