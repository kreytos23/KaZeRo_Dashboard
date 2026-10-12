import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { admin } from './auth';

// Los valores son los nombres de las tablas: kz_auditar (0009) usa TG_TABLE_NAME::entidad_auditoria.
export const entidadAuditoria = pgEnum('entidad_auditoria', [
  'pieza',
  'vendedor',
  'cliente',
  'exhibidor',
  'categoria',
  'material',
  'proveedor',
]);

/**
 * Cabecera de una edición (R-08), de solo inserción. La escribe el trigger kz_auditar (0009), nunca la app:
 * kazero_app solo tiene SELECT. Sin updated_at: una fila de bitácora no cambia.
 */
export const auditoria = pgTable(
  'auditoria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Orden total: dos ediciones pueden compartir created_at (now() es la hora de inicio de la transacción).
    orden: bigserial('orden', { mode: 'number' }).notNull(),
    entidad: entidadAuditoria('entidad').notNull(),
    // Sin FK (apunta a la tabla que dice `entidad`): la llena el trigger con NEW.id de la fila editada y
    // kazero_app no tiene DELETE en esas tablas, así que la referencia no puede quedar colgando.
    entidadId: uuid('entidad_id').notNull(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admin.id),
    motivo: text('motivo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auditoria_entidad_idx').on(t.entidad, t.entidadId, t.orden),
    index('auditoria_admin_idx').on(t.adminId),
    check(
      'auditoria_motivo_largo',
      sql`${t.motivo} IS NULL OR char_length(btrim(${t.motivo})) BETWEEN 1 AND 200`,
    ),
  ],
);

/** Un campo que cambió en una edición. `antes`/`despues` en texto canónico; en llaves foráneas, el nombre. */
export const auditoriaCampo = pgTable(
  'auditoria_campo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditoriaId: uuid('auditoria_id')
      .notNull()
      .references(() => auditoria.id),
    posicion: smallint('posicion').notNull(),
    campo: text('campo').notNull(),
    antes: text('antes'),
    despues: text('despues'),
  },
  (t) => [
    // También sirve de índice de la FK (empieza por auditoria_id).
    uniqueIndex('auditoria_campo_uq').on(t.auditoriaId, t.posicion),
    check('auditoria_campo_nombre', sql`${t.campo} ~ '^[a-z_]{1,40}$'`),
    check('auditoria_campo_posicion', sql`${t.posicion} BETWEEN 1 AND 50`),
    check(
      'auditoria_campo_largo',
      sql`(${t.antes} IS NULL OR char_length(${t.antes}) <= 2000) AND (${t.despues} IS NULL OR char_length(${t.despues}) <= 2000)`,
    ),
    check('auditoria_campo_cambia', sql`${t.antes} IS DISTINCT FROM ${t.despues}`),
  ],
);
