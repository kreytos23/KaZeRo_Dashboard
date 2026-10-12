/**
 * Tarjeta de lealtad (R-20 a R-29). Lógica pura: la usa el servicio (autoridad) y la UI (vista previa).
 * Las reglas "Config" (R-21, R-22) llegan como parámetro; hasta que exista config_regla (Plan 5) valen
 * REGLAS_LEALTAD. El % aplicado se guarda en cada pedido (R-27), así que cambiarlas no toca pedidos viejos.
 */
export interface ReglasLealtad {
  /** R-21: posiciones por ciclo. */
  tamanoCiclo: number;
  /** R-22: posición → descuento en centésimas de punto (1000 = 10 %). */
  descuentosBps: Readonly<Record<number, number>>;
}

export const REGLAS_LEALTAD: ReglasLealtad = { tamanoCiclo: 10, descuentosBps: { 5: 1000, 10: 2000 } };

export interface Posicion {
  ciclo: number;
  posicion: number;
}

/**
 * R-23 / R-24 / R-26: la posición libre más baja de la tarjeta, recorriendo los ciclos desde el 1
 * (un hueco por cancelación en un ciclo anterior se llena primero, decisión P4). Si todos están llenos,
 * ciclo nuevo en la posición 1. `ocupadas` = pedidos no cancelados que cuentan para la tarjeta.
 */
export function siguientePosicion(ocupadas: readonly Posicion[], reglas = REGLAS_LEALTAD): Posicion {
  const porCiclo = new Map<number, Set<number>>();
  let maxCiclo = 0;
  for (const o of ocupadas) {
    let usadas = porCiclo.get(o.ciclo);
    if (!usadas) porCiclo.set(o.ciclo, (usadas = new Set()));
    usadas.add(o.posicion);
    if (o.ciclo > maxCiclo) maxCiclo = o.ciclo;
  }
  for (let ciclo = 1; ciclo <= maxCiclo; ciclo++) {
    const usadas = porCiclo.get(ciclo);
    for (let posicion = 1; posicion <= reglas.tamanoCiclo; posicion++)
      if (!usadas?.has(posicion)) return { ciclo, posicion };
  }
  return { ciclo: maxCiclo + 1, posicion: 1 };
}

export type SinLealtad = 'saldo_pendiente';

/**
 * R-22: % de la posición. R-28: sin tarjeta no hay descuento. R-29: en una posición con descuento,
 * si el cliente tiene OTRA nota con saldo pendiente, no hay descuento y queda el motivo (la posición
 * se ocupa igual).
 */
export function descuentoLealtad(
  d: { cuentaTarjeta: boolean; posicion: number | null; otraNotaConSaldo: boolean },
  reglas = REGLAS_LEALTAD,
): { pctBps: number; sinLealtad: SinLealtad | null } {
  if (!d.cuentaTarjeta || d.posicion === null) return { pctBps: 0, sinLealtad: null };
  const pctBps = reglas.descuentosBps[d.posicion] ?? 0;
  if (pctBps === 0) return { pctBps: 0, sinLealtad: null };
  if (d.otraNotaConSaldo) return { pctBps: 0, sinLealtad: 'saldo_pendiente' };
  return { pctBps, sinLealtad: null };
}

export type EstadoCasilla = 'contada' | 'apartada' | 'libre';
export interface Casilla {
  posicion: number;
  estado: EstadoCasilla;
  folio: number | null;
  pctBps: number;
}
export interface CicloTarjeta {
  ciclo: number;
  casillas: Casilla[];
  contadas: number;
}

/** R-25: ● contada (pedido liquidado), ◐ apartada (abierto), ○ libre. Recibe pedidos no cancelados que cuentan. */
export function armarTarjeta(
  pedidos: readonly { ciclo: number; posicion: number; estado: 'abierto' | 'liquidado'; folio: number }[],
  reglas = REGLAS_LEALTAD,
): CicloTarjeta[] {
  const maxCiclo = pedidos.reduce((m, p) => Math.max(m, p.ciclo), 1);
  const ciclos: CicloTarjeta[] = [];
  for (let ciclo = 1; ciclo <= maxCiclo; ciclo++) {
    const casillas: Casilla[] = Array.from({ length: reglas.tamanoCiclo }, (_, i) => ({
      posicion: i + 1,
      estado: 'libre',
      folio: null,
      pctBps: reglas.descuentosBps[i + 1] ?? 0,
    }));
    for (const p of pedidos) {
      const c = p.ciclo === ciclo ? casillas[p.posicion - 1] : undefined;
      if (c) Object.assign(c, { estado: p.estado === 'liquidado' ? 'contada' : 'apartada', folio: p.folio });
    }
    ciclos.push({ ciclo, casillas, contadas: casillas.filter((c) => c.estado === 'contada').length });
  }
  return ciclos;
}
