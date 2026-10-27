import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { admin } from './auth';
import { vendedor } from './inventario';
import { pedido } from './pedidos';

// Plan 5a. Cortes y líneas son de solo inserción; un pago solo se anula. Las reglas que no caben en un CHECK
// (coherencia con el pedido, monto = Σ líneas, inmutabilidad) están en drizzle/0019_comisiones_reglas.sql.
const ts = (nombre: string) => timestamp(nombre, { withTimezone: true });
const dinero = (nombre: string) => numeric(nombre, { precision: 12, scale: 2 });

export const metodoPagoComision = pgEnum('metodo_pago_comision', ['efectivo', 'transferencia', 'otro']);

export const corteComision = pgTable(
  'corte_comision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mes: date('mes').notNull(),
    cerradoAt: ts('cerrado_at').notNull().defaultNow(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admin.id),
  },
  (t) => [
    uniqueIndex('corte_comision_mes_uq').on(t.mes),
    index('corte_comision_admin_idx').on(t.adminId),
    check('corte_comision_mes_inicio', sql`extract(day from ${t.mes}) = 1`),
  ],
);

export const comisionLinea = pgTable(
  'comision_linea',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    corteId: uuid('corte_id')
      .notNull()
      .references(() => corteComision.id),
    vendedorId: uuid('vendedor_id')
      .notNull()
      .references(() => vendedor.id),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedido.id),
    fechaLiquidacion: date('fecha_liquidacion').notNull(),
    base: dinero('base').notNull(),
    pct: numeric('pct', { precision: 5, scale: 2 }).notNull(),
    monto: dinero('monto').notNull(),
  },
  (t) => [
    uniqueIndex('comision_linea_pedido_uq').on(t.pedidoId),
    index('comision_linea_corte_vendedor_idx').on(t.corteId, t.vendedorId),
    index('comision_linea_vendedor_idx').on(t.vendedorId),
    check('comision_linea_base', sql`${t.base} >= 0`),
    check('comision_linea_pct', sql`${t.pct} >= 0 AND ${t.pct} <= 100`),
    check('comision_linea_monto', sql`${t.monto} >= 0 AND ${t.monto} <= ${t.base}`),
  ],
);

export const pagoComision = pgTable(
  'pago_comision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    corteId: uuid('corte_id')
      .notNull()
      .references(() => corteComision.id),
    vendedorId: uuid('vendedor_id')
      .notNull()
      .references(() => vendedor.id),
    fecha: date('fecha').notNull(),
    monto: dinero('monto').notNull(),
    metodo: metodoPagoComision('metodo').notNull(),
    nota: text('nota'),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admin.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    anuladoAt: ts('anulado_at'),
    anulacionMotivo: text('anulacion_motivo'),
    anuladoPor: uuid('anulado_por').references(() => admin.id),
  },
  (t) => [
    uniqueIndex('pago_comision_vigente_uq')
      .on(t.corteId, t.vendedorId)
      .where(sql`${t.anuladoAt} IS NULL`),
    index('pago_comision_vendedor_idx').on(t.vendedorId),
    index('pago_comision_admin_idx').on(t.adminId),
    index('pago_comision_anulado_por_idx').on(t.anuladoPor),
    check('pago_comision_monto', sql`${t.monto} > 0`),
    check('pago_comision_nota', sql`${t.nota} IS NULL OR char_length(${t.nota}) <= 200`),
    check(
      'pago_comision_anulacion',
      sql`(${t.anuladoAt} IS NULL AND ${t.anulacionMotivo} IS NULL AND ${t.anuladoPor} IS NULL)
    OR (${t.anuladoAt} IS NOT NULL AND ${t.anuladoPor} IS NOT NULL AND char_length(btrim(${t.anulacionMotivo})) BETWEEN 1 AND 200)`,
    ),
  ],
);
