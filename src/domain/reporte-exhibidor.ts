import { mesDe, type Mes } from './comisiones';

/** Movimiento de pieza con este exhibidor; `dia` es su fecha en horario de México (X-2). */
export interface MovExhibidor {
  piezaId: string;
  orden: number;
  tipo: string;
  deEstado: string | null;
  aEstado: string;
  dia: string;
  pedidoId: string | null;
}

const delta = (m: MovExhibidor) =>
  (m.aEstado === 'en_exhibidor' ? 1 : 0) - (m.deEstado === 'en_exhibidor' ? 1 : 0);

/** Ids de las piezas en el exhibidor al terminar `mes`: su último movimiento con él las dejó ahí. */
export function piezasAlCierre(movs: readonly MovExhibidor[], mes: Mes): string[] {
  const ultimo = new Map<string, MovExhibidor>();
  for (const m of movs) {
    const previo = ultimo.get(m.piezaId);
    if (mesDe(m.dia) <= mes && (!previo || m.orden > previo.orden)) ultimo.set(m.piezaId, m);
  }
  return [...ultimo.values()].filter((m) => m.aEstado === 'en_exhibidor').map((m) => m.piezaId);
}

/** X-3: nota → piezas que salieron de este exhibidor hacia ella en el mes. */
export function notasVendidas(movs: readonly MovExhibidor[], mes: Mes): Map<string, number> {
  const notas = new Map<string, number>();
  for (const m of movs)
    if (m.tipo === 'apartado' && m.pedidoId && delta(m) < 0 && mesDe(m.dia) === mes)
      notas.set(m.pedidoId, (notas.get(m.pedidoId) ?? 0) + 1);
  return notas;
}

/**
 * Qué hoja sale: la de un exhibidor con piezas al cierre del mes (la hoja sirve para entregarlas) o, si se pidieron
 * las ventas del mes, la de uno que vendió en él. El dinero no cuenta: la hoja ya no lo muestra.
 */
export function hojaSale(o: { piezasAlCierre: number; notasDelMes: number; ventas: boolean }): boolean {
  return o.piezasAlCierre > 0 || (o.ventas && o.notasDelMes > 0);
}

/** Parámetro `ventas` de la página y del PDF: solo «1» incluye las ventas del mes; lo demás cuenta como apagado. */
export function incluirVentas(v: unknown): boolean {
  return v === '1';
}
