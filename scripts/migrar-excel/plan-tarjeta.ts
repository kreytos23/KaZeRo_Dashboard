import { siguientePosicion } from '../../src/domain/lealtad';

export interface PedidoTarjeta {
  id: string;
  /** Fecha ISO del pedido. */
  fecha: string;
  estado: 'abierto' | 'liquidado';
  tipo: 'kzr' | 'historico' | 'inventario';
}
/** Celda de la hoja "Tarjeta de Lealtad": null = vacía; `tbd` = "TBD"; sin fecha = texto u otro valor. */
export type CeldaHoja = { fecha: string | null; tbd?: boolean } | null;
export interface Marcador {
  ciclo: number;
  posicion: number;
  fecha: string;
}
export interface EntradaTarjeta {
  /** Pedidos del cliente que pueden contar para la tarjeta (sin regalos, "no se cobró" ni genérico). */
  pedidos: PedidoTarjeta[];
  /** Una fila de la hoja por ciclo, de la primera a la última; 10 celdas por fila. */
  filasHoja: CeldaHoja[][];
  /** Evidencia de la columna "Tarjeta de Lealtad" del Concentrado, por pedido. */
  evidencia: Map<string, { posicion: number; fecha: string | null }>;
  /** Fecha para un marcador sin ninguna celda con fecha cerca. */
  fechaRespaldo?: string;
}
export interface SalidaTarjeta {
  asignados: Map<string, { ciclo: number; posicion: number }>;
  marcadores: Marcador[];
  sinTarjeta: string[];
  /** Códigos fijos (sin datos del cliente), p. ej. `marcador_hueco`. */
  avisos: string[];
}

const TAMANO = 10;
const DIA = 86_400_000;
const dias = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA;

interface Slot {
  ciclo: number;
  posicion: number;
  celda: NonNullable<CeldaHoja>;
}

/** D-12: casa cada celda de la hoja con un pedido del cliente; lo que no casa se resuelve sin inventar ventas. */
export function asignarTarjeta(c: EntradaTarjeta): SalidaTarjeta {
  const avisos: string[] = [];
  const slots: Slot[] = [];
  const ultimaLlena = new Map<number, number>(); // ciclo → mayor posición llena
  c.filasHoja.forEach((fila, k) => {
    fila.slice(0, TAMANO).forEach((celda, i) => {
      if (!celda) return;
      slots.push({ ciclo: k + 1, posicion: i + 1, celda });
      ultimaLlena.set(k + 1, Math.max(ultimaLlena.get(k + 1) ?? 0, i + 1));
    });
  });

  const asignados = new Map<string, { ciclo: number; posicion: number }>();
  const libres = new Set(slots);
  const sin = new Set(c.pedidos.map((p) => p.id));
  const porId = new Map(c.pedidos.map((p) => [p.id, p]));

  /** Empareja de menor a mayor puntaje; desempata por fecha, id, ciclo y posición (determinista). */
  function emparejar(puntaje: (p: PedidoTarjeta, s: Slot) => number | null) {
    const pares: { p: PedidoTarjeta; s: Slot; n: number }[] = [];
    for (const id of sin)
      for (const s of libres) {
        const p = porId.get(id)!;
        const n = puntaje(p, s);
        if (n !== null) pares.push({ p, s, n });
      }
    pares.sort(
      (a, b) =>
        a.n - b.n ||
        a.p.fecha.localeCompare(b.p.fecha) ||
        a.p.id.localeCompare(b.p.id) ||
        a.s.ciclo - b.s.ciclo ||
        a.s.posicion - b.s.posicion,
    );
    for (const { p, s } of pares) {
      if (!sin.has(p.id) || !libres.has(s)) continue;
      asignados.set(p.id, { ciclo: s.ciclo, posicion: s.posicion });
      sin.delete(p.id);
      libres.delete(s);
    }
  }

  // 1) Evidencia de la columna: misma posición y fecha a ±3 días.
  emparejar((p, s) => {
    const ev = c.evidencia.get(p.id);
    if (!ev || ev.posicion !== s.posicion || s.celda.tbd) return null;
    const ref = ev.fecha ?? p.fecha;
    if (!s.celda.fecha) return 2;
    const d = dias(ref, s.celda.fecha);
    return d <= 3 ? d : null;
  });
  // 2) Fecha del pedido a ±3 días de la fecha de la celda.
  emparejar((p, s) => {
    if (!s.celda.fecha) return null;
    const d = dias(p.fecha, s.celda.fecha);
    return d <= 3 ? d : null;
  });
  // 3) Evidencia de la columna: solo la posición (una celda "TBD" solo admite un pedido abierto).
  emparejar((p, s) => {
    const ev = c.evidencia.get(p.id);
    if (!ev || ev.posicion !== s.posicion) return null;
    if (s.celda.tbd && p.estado !== 'abierto') return null;
    return s.ciclo;
  });
  // 4) "TBD" con un pedido abierto, en orden.
  emparejar((p, s) => (s.celda.tbd && p.estado === 'abierto' ? 0 : null));

  // Marcadores: celdas llenas sin pedido y huecos antes de la última celda llena de cada ciclo.
  const fechaCerca = (ciclo: number, posicion: number): string => {
    const fila = c.filasHoja[ciclo - 1] ?? [];
    for (let i = posicion - 2; i >= 0; i--) if (fila[i]?.fecha) return fila[i]!.fecha!;
    for (let i = posicion; i < TAMANO; i++) if (fila[i]?.fecha) return fila[i]!.fecha!;
    return c.fechaRespaldo ?? '1970-01-01';
  };
  const marcadores: Marcador[] = [];
  for (const s of libres) {
    marcadores.push({
      ciclo: s.ciclo,
      posicion: s.posicion,
      fecha: s.celda.fecha ?? fechaCerca(s.ciclo, s.posicion),
    });
    avisos.push('marcador_celda_sin_pedido');
  }
  const llenas = new Set(slots.map((s) => `${s.ciclo}:${s.posicion}`));
  for (const [ciclo, hasta] of ultimaLlena)
    for (let posicion = 1; posicion < hasta; posicion++)
      if (!llenas.has(`${ciclo}:${posicion}`)) {
        marcadores.push({ ciclo, posicion, fecha: fechaCerca(ciclo, posicion) });
        avisos.push('marcador_hueco');
      }
  marcadores.sort((a, b) => a.ciclo - b.ciclo || a.posicion - b.posicion);

  // Notas KZR sin celda: siguientes posiciones libres (son pedidos del sistema actual, R-23).
  const ocupadas = [...asignados.values(), ...marcadores.map(({ ciclo, posicion }) => ({ ciclo, posicion }))];
  const kzr = [...sin]
    .map((id) => porId.get(id)!)
    .filter((p) => p.tipo === 'kzr')
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  for (const p of kzr) {
    const pos = siguientePosicion(ocupadas);
    asignados.set(p.id, pos);
    ocupadas.push(pos);
    sin.delete(p.id);
    avisos.push('kzr_sin_celda');
  }
  const sinTarjeta = [...sin].sort();
  if (sinTarjeta.length) avisos.push(...sinTarjeta.map(() => 'historico_sin_celda'));
  return { asignados, marcadores, sinTarjeta, avisos };
}
