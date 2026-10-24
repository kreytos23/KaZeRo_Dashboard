/**
 * Tarjeta de lealtad (R-20 a R-28; R-29 derogada 2026-10-23). Lógica pura: la usa el servicio (autoridad) y la UI (vista previa).
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
 * D-2 (Plan 3.1): la tarjeta actual es la vuelta más alta con algún pedido vigente. Se toma su lugar libre más
 * bajo (un lugar cancelado de la tarjeta actual se reutiliza); si está llena, vuelta nueva en el 1. Los huecos
 * de vueltas anteriores NO se rellenan.
 */
export function siguientePosicion(ocupadas: readonly Posicion[], reglas = REGLAS_LEALTAD): Posicion {
  if (!ocupadas.length) return { ciclo: 1, posicion: 1 };
  const actual = ocupadas.reduce((m, o) => Math.max(m, o.ciclo), 1);
  const usadas = new Set(ocupadas.filter((o) => o.ciclo === actual).map((o) => o.posicion));
  for (let posicion = 1; posicion <= reglas.tamanoCiclo; posicion++)
    if (!usadas.has(posicion)) return { ciclo: actual, posicion };
  return { ciclo: actual + 1, posicion: 1 };
}

/** R-22 / R-28. R-29 derogada (reunión 2026-10-23): el descuento no depende de otras notas con saldo. */
export function descuentoLealtad(
  d: { cuentaTarjeta: boolean; posicion: number | null },
  reglas = REGLAS_LEALTAD,
): { pctBps: number } {
  if (!d.cuentaTarjeta || d.posicion === null) return { pctBps: 0 };
  return { pctBps: reglas.descuentosBps[d.posicion] ?? 0 };
}

export interface Casilla {
  posicion: number;
  estado: 'ocupada' | 'libre';
  folio: number | null;
  pctBps: number;
  conSaldo: boolean;
}
export interface Tarjeta {
  casillas: Casilla[];
  ocupadas: number;
}

/** R-25 (D-4): solo la tarjeta actual. Ocupada = pedido no cancelado (cuenta al crear); conSaldo es informativo. */
export function armarTarjeta(
  pedidos: readonly {
    ciclo: number;
    posicion: number;
    estado: 'abierto' | 'liquidado';
    folio: number;
    conSaldo: boolean;
  }[],
  reglas = REGLAS_LEALTAD,
): Tarjeta {
  const actual = pedidos.reduce((m, p) => Math.max(m, p.ciclo), 1);
  const casillas: Casilla[] = Array.from({ length: reglas.tamanoCiclo }, (_, i) => ({
    posicion: i + 1,
    estado: 'libre',
    folio: null,
    pctBps: reglas.descuentosBps[i + 1] ?? 0,
    conSaldo: false,
  }));
  for (const p of pedidos) {
    const c = p.ciclo === actual ? casillas[p.posicion - 1] : undefined;
    if (c) Object.assign(c, { estado: 'ocupada', folio: p.folio, conSaldo: p.conSaldo });
  }
  return { casillas, ocupadas: casillas.filter((c) => c.estado === 'ocupada').length };
}
