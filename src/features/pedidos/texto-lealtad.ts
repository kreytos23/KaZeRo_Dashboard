import type { Casilla, Tarjeta } from '@/domain/lealtad';
import { formatoFolio, formatoPct, numericAPctBps } from '@/domain/pedidos';
import type { TarjetaPrevia } from './tipos';

/** Una sola fuente para los textos de lealtad de la vista previa, la ficha y la tarjeta (E2E depende de ellos). */
export function textoLealtadPrevia(
  t: TarjetaPrevia | null,
  o: { cuentaTarjeta: boolean; hayCliente: boolean },
): string {
  if (!o.cuentaTarjeta) return 'No cuenta para la tarjeta de lealtad.';
  if (!o.hayCliente || !t) return 'Elige un cliente para ver su tarjeta.';
  // La vuelta de la tarjeta es interna (Plan 3.1): no se muestra.
  const quien = `Pedido ${t.posicion} de su tarjeta`;
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
  // Motivo histórico: R-29 se derogó el 2026-10-23, pero los pedidos viejos lo conservan (R-27).
  if (p.sinLealtadMotivo === 'saldo_pendiente') return 'Sin descuento (regla anterior: saldo pendiente)';
  const donde = `Lugar ${p.posicionTarjeta}`;
  const bps = numericAPctBps(p.descuentoLealtadPct);
  return bps > 0 ? `${donde}: −${formatoPct(bps)}` : `${donde}.`;
}

/** Nombre accesible de una casilla: «Lugar 5: KZR-31, con saldo». */
export function etiquetaCasilla(c: Casilla): string {
  const partes = [`Lugar ${c.posicion}`];
  const detalle: string[] = [];
  if (c.estado === 'libre') detalle.push('libre');
  if (c.folio !== null) detalle.push(formatoFolio(c.folio));
  if (c.conSaldo) detalle.push('con saldo');
  if (c.pctBps > 0) detalle.push(`${formatoPct(c.pctBps)} de descuento`);
  return detalle.length ? `${partes[0]}: ${detalle.join(', ')}` : partes[0]!;
}

/** Pie de la tarjeta: «3 de 10 · faltan 2 para el 10 %». El siguiente premio es el primer lugar con descuento aún por llenar. */
export function pieTarjeta(t: Tarjeta): string {
  const total = t.casillas.length;
  const premio = t.casillas.find((c) => c.pctBps > 0 && c.posicion > t.ocupadas);
  if (!premio) return `${t.ocupadas} de ${total} · tarjeta completa`;
  const faltan = premio.posicion - t.ocupadas;
  return `${t.ocupadas} de ${total} · ${faltan === 1 ? 'falta 1' : `faltan ${faltan}`} para el ${formatoPct(premio.pctBps)}`;
}
