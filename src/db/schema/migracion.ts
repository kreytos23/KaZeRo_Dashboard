import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { categoria, cliente, exhibidor, material, pieza, proveedor, vendedor } from './inventario';
import { pago, pedido } from './pedidos';

// Plan 7a (D-5): de qué fila de Excel salió cada entidad migrada. Idempotencia, detección de filas cambiadas,
// conciliación de la fase 2 (pagos resumidos) y R-48 (Plan 5). Una FK por tipo (como pago, D-4 del Plan 3).
export const origenExcel = pgTable(
  'origen_excel',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lote: text('lote').notNull(),
    clave: text('clave').notNull(),
    hoja: text('hoja').notNull(),
    filas: integer('filas')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    hashContenido: text('hash_contenido').notNull(),
    datos: jsonb('datos')
      .notNull()
      .default(sql`'{}'::jsonb`),
    categoriaId: uuid('categoria_id').references(() => categoria.id),
    materialId: uuid('material_id').references(() => material.id),
    proveedorId: uuid('proveedor_id').references(() => proveedor.id),
    vendedorId: uuid('vendedor_id').references(() => vendedor.id),
    clienteId: uuid('cliente_id').references(() => cliente.id),
    exhibidorId: uuid('exhibidor_id').references(() => exhibidor.id),
    piezaId: uuid('pieza_id').references(() => pieza.id),
    pedidoId: uuid('pedido_id').references(() => pedido.id),
    pagoId: uuid('pago_id').references(() => pago.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('origen_excel_clave_uq').on(t.lote, t.clave),
    index('origen_excel_categoria_idx')
      .on(t.categoriaId)
      .where(sql`${t.categoriaId} IS NOT NULL`),
    index('origen_excel_material_idx')
      .on(t.materialId)
      .where(sql`${t.materialId} IS NOT NULL`),
    index('origen_excel_proveedor_idx')
      .on(t.proveedorId)
      .where(sql`${t.proveedorId} IS NOT NULL`),
    index('origen_excel_vendedor_idx')
      .on(t.vendedorId)
      .where(sql`${t.vendedorId} IS NOT NULL`),
    index('origen_excel_cliente_idx')
      .on(t.clienteId)
      .where(sql`${t.clienteId} IS NOT NULL`),
    index('origen_excel_exhibidor_idx')
      .on(t.exhibidorId)
      .where(sql`${t.exhibidorId} IS NOT NULL`),
    index('origen_excel_pieza_idx')
      .on(t.piezaId)
      .where(sql`${t.piezaId} IS NOT NULL`),
    index('origen_excel_pedido_idx')
      .on(t.pedidoId)
      .where(sql`${t.pedidoId} IS NOT NULL`),
    index('origen_excel_pago_idx')
      .on(t.pagoId)
      .where(sql`${t.pagoId} IS NOT NULL`),
    check('origen_excel_lote_formato', sql`${t.lote} ~ '^[a-z0-9-]{1,40}$'`),
    check('origen_excel_clave_largo', sql`char_length(${t.clave}) BETWEEN 1 AND 200`),
    check('origen_excel_hoja_largo', sql`char_length(${t.hoja}) BETWEEN 1 AND 60`),
    check('origen_excel_hash_formato', sql`${t.hashContenido} ~ '^[0-9a-f]{64}$'`),
    check(
      'origen_excel_una_entidad',
      sql`num_nonnulls(${t.categoriaId}, ${t.materialId}, ${t.proveedorId}, ${t.vendedorId}, ${t.clienteId}, ${t.exhibidorId}, ${t.piezaId}, ${t.pedidoId}, ${t.pagoId}) = 1`,
    ),
  ],
);
