import { pesosACentavos, porcentajeANumeric } from './dinero';

export type EntidadAuditada =
  'pieza' | 'vendedor' | 'cliente' | 'exhibidor' | 'categoria' | 'material' | 'proveedor';
export type Valor = string | null;
export interface Cambio {
  campo: string;
  antes: Valor;
  despues: Valor;
}

export const MAX_MOTIVO = 200;

/**
 * Campos de dinero por entidad (R-09): cambiarlos exige motivo.
 * DEBE coincidir con la lista de kz_auditar (drizzle/0009_auditoria_reglas.sql).
 */
export const CAMPOS_DINERO: Readonly<Record<EntidadAuditada, readonly string[]>> = {
  pieza: ['costo', 'precio'],
  vendedor: ['comision_pct'],
  cliente: [],
  exhibidor: [],
  categoria: [],
  material: [],
  proveedor: [],
};

/** Campos que cambian, en el orden de `despues`. Los valores llegan ya canónicos ('149.00', uuid, 'true'). */
export function calcularCambios(
  antes: Readonly<Record<string, Valor>>,
  despues: Readonly<Record<string, Valor>>,
): Cambio[] {
  return Object.entries(despues)
    .filter(([campo, valor]) => (antes[campo] ?? null) !== valor)
    .map(([campo, valor]) => ({ campo, antes: antes[campo] ?? null, despues: valor }));
}

export function requiereMotivo(entidad: EntidadAuditada, cambios: readonly Cambio[]): boolean {
  return cambios.some((c) => CAMPOS_DINERO[entidad].includes(c.campo));
}

export type ResultadoMotivo = { ok: true; motivo: string | null } | { ok: false; error: string };

/** Largo en code points, como char_length de Postgres (un emoji cuenta 1, no 2). */
export function validarMotivo(
  texto: string | null | undefined,
  requerido: boolean,
  faltante = 'Escribe el motivo: cambiaste un monto.',
): ResultadoMotivo {
  const motivo = (texto ?? '').trim();
  if ([...motivo].length > MAX_MOTIVO)
    return { ok: false, error: `El motivo admite hasta ${MAX_MOTIVO} caracteres.` };
  if (!motivo) return requerido ? { ok: false, error: faltante } : { ok: true, motivo: null };
  return { ok: true, motivo };
}

/** ¿El usuario cambió este monto? '149' y '149.00' son el mismo; un texto ilegible cuenta como cambio. */
export function montoCambio(tipo: 'pesos' | 'porcentaje', valor: string, original: string): boolean {
  const canon = (t: string) => (tipo === 'pesos' ? pesosACentavos(t) : porcentajeANumeric(t));
  const nuevo = canon(valor);
  return nuevo === null || nuevo !== canon(original);
}

export interface FilaHistorial {
  auditoriaId: string;
  fecha: Date;
  adminEmail: string;
  motivo: string | null;
  campo: string;
  antes: Valor;
  despues: Valor;
}
export interface EntradaHistorial {
  id: string;
  fecha: Date;
  adminEmail: string;
  motivo: string | null;
  campos: Cambio[];
}

/** Las filas llegan de v_auditoria ya ordenadas (edición más reciente primero, campos por posición). */
export function agruparHistorial(filas: readonly FilaHistorial[]): EntradaHistorial[] {
  const porId = new Map<string, EntradaHistorial>();
  for (const f of filas) {
    let e = porId.get(f.auditoriaId);
    if (!e) {
      e = { id: f.auditoriaId, fecha: f.fecha, adminEmail: f.adminEmail, motivo: f.motivo, campos: [] };
      porId.set(f.auditoriaId, e);
    }
    e.campos.push({ campo: f.campo, antes: f.antes, despues: f.despues });
  }
  return [...porId.values()];
}
