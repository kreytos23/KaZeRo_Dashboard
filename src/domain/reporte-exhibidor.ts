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

export interface CuadrePiezas {
  alInicio: number;
  enviadas: number;
  vendidas: number;
  regresadas: number;
  porCancelacion: number;
  /** Cambios manuales y correcciones, con signo. */
  otros: number;
  alCierre: number;
}

const delta = (m: MovExhibidor) =>
  (m.aEstado === 'en_exhibidor' ? 1 : 0) - (m.deEstado === 'en_exhibidor' ? 1 : 0);

/** X-2: el delta sale de los estados (venta y liberar con exhibidor cerrado no mueven nada); el tipo da la columna. */
export function cuadrePiezas(movs: readonly MovExhibidor[], mes: Mes): CuadrePiezas {
  const c = { alInicio: 0, enviadas: 0, vendidas: 0, regresadas: 0, porCancelacion: 0, otros: 0 };
  for (const m of movs) {
    const d = delta(m);
    const mesMov = mesDe(m.dia);
    if (d === 0 || mesMov > mes) continue;
    if (mesMov < mes) c.alInicio += d;
    else if (m.tipo === 'envio_exhibidor' || m.tipo === 'alta') c.enviadas += d;
    else if (m.tipo === 'apartado') c.vendidas -= d;
    else if (m.tipo === 'regreso') c.regresadas -= d;
    else if (m.tipo === 'liberacion') c.porCancelacion += d;
    else c.otros += d;
  }
  return {
    ...c,
    alCierre: c.alInicio + c.enviadas - c.vendidas - c.regresadas + c.porCancelacion + c.otros,
  };
}

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

export interface MovDinero {
  tipo: 'cobro' | 'entrega' | 'ajuste';
  fecha: string;
  /** Con signo en los ajustes; cobros y entregas son positivos. */
  centavos: number;
}

export interface CuadreDinero {
  alInicio: number;
  cobrado: number;
  entregado: number;
  ajustes: number;
  alCierre: number;
}

/** X-6 / E-5: por entregar = cobros − entregas + ajustes, por la fecha de cada evento. */
export function cuadreDinero(movs: readonly MovDinero[], mes: Mes): CuadreDinero {
  const c = { alInicio: 0, cobrado: 0, entregado: 0, ajustes: 0 };
  for (const m of movs) {
    const mesMov = mesDe(m.fecha);
    if (mesMov > mes) continue;
    const efecto = m.tipo === 'entrega' ? -m.centavos : m.centavos;
    if (mesMov < mes) c.alInicio += efecto;
    else if (m.tipo === 'cobro') c.cobrado += m.centavos;
    else if (m.tipo === 'entrega') c.entregado += m.centavos;
    else c.ajustes += m.centavos;
  }
  return { ...c, alCierre: c.alInicio + c.cobrado - c.entregado + c.ajustes };
}

/** El reporte solo incluye exhibidores con piezas al inicio, movimiento o dinero en el mes. */
export function hojaConActividad(p: CuadrePiezas, d: CuadreDinero): boolean {
  return (
    p.alInicio !== 0 ||
    p.enviadas !== 0 ||
    p.vendidas !== 0 ||
    p.regresadas !== 0 ||
    p.porCancelacion !== 0 ||
    p.otros !== 0 ||
    d.alInicio !== 0 ||
    d.cobrado !== 0 ||
    d.entregado !== 0 ||
    d.ajustes !== 0
  );
}

/**
 * La hoja sirve para entregar las piezas: sale la de un exhibidor abierto con piezas al cierre aunque no haya
 * tenido movimiento en el mes, y la de cualquiera con actividad en él (piezas o dinero).
 */
export function hojaSale(
  p: CuadrePiezas,
  d: CuadreDinero,
  o: { abierto: boolean; piezasAlCierre: number },
): boolean {
  return (o.abierto && o.piezasAlCierre > 0) || hojaConActividad(p, d);
}

/** Parámetro `ventas` de la página y del PDF: solo «1» incluye las ventas del mes; lo demás cuenta como apagado. */
export function incluirVentas(v: unknown): boolean {
  return v === '1';
}
