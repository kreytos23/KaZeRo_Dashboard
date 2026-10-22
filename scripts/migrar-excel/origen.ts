import { createHash } from 'node:crypto';
import { jsonCanonico } from './ids';
import type { Origen } from './tipos';

/** Valor JSON estable: las fechas pasan a ISO (el hash canónico no admite `Date`). */
export function aJson(v: unknown): unknown {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(aJson);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, aJson(x)]));
  }
  return v === undefined ? null : v;
}

/**
 * El número de fila va en `filas` (y en `datos`), no en el hash: insertar filas en el libro no debe marcar como
 * cambiadas las que quedan debajo.
 */
function sinFila(d: unknown): unknown {
  if (Array.isArray(d)) return d.map(sinFila);
  if (d && typeof d === 'object') return Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'fila'));
  return d;
}

/** Marcador de origen (D-5): clave estable, filas del Excel, hash de la fila normalizada y datos crudos. */
export function crearOrigen(clave: string, hoja: string, filas: number[], datos: unknown): Origen {
  const d = aJson(datos);
  return {
    clave,
    hoja,
    filas,
    hash: createHash('sha256')
      .update(jsonCanonico(sinFila(d)))
      .digest('hex'),
    datos: d,
  };
}
