import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { vAuditoria } from '@/db/schema';
import {
  agruparHistorial,
  requiereMotivo,
  validarMotivo,
  type Cambio,
  type EntidadAuditada,
  type EntradaHistorial,
} from '@/domain/auditoria';
import { ErrorNegocio } from '@/server/errores';

/**
 * Quién y por qué de la edición: lo lee el trigger kz_auditar (0009). `set_config(…, true)` es local a la
 * transacción (se borra en COMMIT/ROLLBACK, no se filtra a otra petición del pool), así que esto se llama
 * SOLO dentro de db.transaction y justo antes del UPDATE. Sin esto, editar una columna auditada falla.
 */
export async function fijarContextoAuditoria(
  tx: Ejecutor,
  c: { adminId: string; motivo: string | null },
): Promise<void> {
  await tx.execute(
    sql`SELECT set_config('kazero.admin_id', ${c.adminId}, true), set_config('kazero.motivo', ${c.motivo ?? ''}, true)`,
  );
}

/** Motivo validado según R-09; el error se muestra junto al campo `motivo` del formulario. */
export function motivoPara(
  entidad: EntidadAuditada,
  cambios: readonly Cambio[],
  texto: string | null | undefined,
): string | null {
  const r = validarMotivo(texto, requiereMotivo(entidad, cambios));
  if (!r.ok) throw new ErrorNegocio('motivo', r.error, 'motivo');
  return r.motivo;
}

const columnas = {
  auditoriaId: vAuditoria.auditoriaId,
  fecha: vAuditoria.fecha,
  adminEmail: vAuditoria.adminEmail,
  motivo: vAuditoria.motivo,
  campo: vAuditoria.campo,
  antes: vAuditoria.antes,
  despues: vAuditoria.despues,
};
const recientes = [desc(vAuditoria.orden), asc(vAuditoria.posicion)] as const;

/** Historial de cambios de una ficha: una sola consulta a la vista, agrupada en memoria. */
export async function historialDeCambios(
  db: Ejecutor,
  entidad: EntidadAuditada,
  entidadId: string,
): Promise<EntradaHistorial[]> {
  const filas = await db
    .select(columnas)
    .from(vAuditoria)
    .where(and(eq(vAuditoria.entidad, entidad), eq(vAuditoria.entidadId, entidadId)))
    .orderBy(...recientes);
  return agruparHistorial(filas);
}

/**
 * Para listas (catálogos): una consulta para todas las entidades de esos tipos, agrupada por id.
 * `limite` cuenta ENTRADAS (ediciones), no filas de campo: se eligen las N más recientes y luego todos sus
 * campos, así la entrada más antigua nunca queda cortada a la mitad.
 */
export async function historialPorEntidad(
  db: Ejecutor,
  entidades: readonly EntidadAuditada[],
  limite = 500,
): Promise<Map<string, EntradaHistorial[]>> {
  const ultimas = db
    .select({ id: vAuditoria.auditoriaId })
    .from(vAuditoria)
    .where(inArray(vAuditoria.entidad, [...entidades]))
    .groupBy(vAuditoria.auditoriaId)
    .orderBy(desc(sql`max(${vAuditoria.orden})`))
    .limit(limite);
  const filas = await db
    .select({ ...columnas, entidadId: vAuditoria.entidadId })
    .from(vAuditoria)
    .where(and(inArray(vAuditoria.entidad, [...entidades]), inArray(vAuditoria.auditoriaId, ultimas)))
    .orderBy(...recientes);
  const porEntidad = new Map<string, typeof filas>();
  for (const f of filas) porEntidad.set(f.entidadId, [...(porEntidad.get(f.entidadId) ?? []), f]);
  return new Map([...porEntidad].map(([id, fs]) => [id, agruparHistorial(fs)]));
}
