import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { admin } from './auth';
import { exhibidor } from './inventario';

// Plan 4a: entregas y ajustes del dinero que cobra un exhibidor. Solo inserción. Que el por entregar no quede
// negativo, la fecha y el cierre sin dinero están en drizzle/0023_exhibidores_dinero_reglas.sql.
const ts = (nombre: string) => timestamp(nombre, { withTimezone: true });
const dinero = (nombre: string) => numeric(nombre, { precision: 12, scale: 2 });

export const metodoEntrega = pgEnum('metodo_entrega', ['efectivo', 'transferencia', 'otro']);
export const tipoEntregaExhibidor = pgEnum('tipo_entrega_exhibidor', ['entrega', 'ajuste']);

export const entregaExhibidor = pgTable(
  'entrega_exhibidor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    exhibidorId: uuid('exhibidor_id')
      .notNull()
      .references(() => exhibidor.id),
    tipo: tipoEntregaExhibidor('tipo').notNull(),
    // Con signo en los ajustes (E-5); una entrega siempre es positiva y resta.
    monto: dinero('monto').notNull(),
    fecha: date('fecha').notNull(),
    metodo: metodoEntrega('metodo'),
    nota: text('nota'),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admin.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('entrega_exhibidor_exhibidor_idx').on(t.exhibidorId, t.fecha),
    index('entrega_exhibidor_admin_idx').on(t.adminId),
    check(
      'entrega_exhibidor_monto',
      sql`(${t.tipo} = 'entrega' AND ${t.monto} > 0) OR (${t.tipo} = 'ajuste' AND ${t.monto} <> 0)`,
    ),
    check('entrega_exhibidor_metodo', sql`(${t.tipo} = 'entrega') = (${t.metodo} IS NOT NULL)`),
    check('entrega_exhibidor_nota', sql`${t.nota} IS NULL OR char_length(${t.nota}) <= 200`),
    // `IS NOT NULL` explícito: con nota NULL, char_length(...) BETWEEN da NULL y un CHECK con NULL pasa.
    check(
      'entrega_exhibidor_ajuste_motivo',
      sql`${t.tipo} <> 'ajuste' OR (${t.nota} IS NOT NULL AND char_length(btrim(${t.nota})) BETWEEN 1 AND 200)`,
    ),
  ],
);
