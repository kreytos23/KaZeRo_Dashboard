import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { admin } from './auth';
import { pedido } from './pedidos';

const ts = (nombre: string) => timestamp(nombre, { withTimezone: true });
// updated_at lo mantiene el trigger kz_tocar_updated_at (0003); el default cubre el INSERT.
const tiempos = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};
const maxLargo = (nombre: string, col: unknown, max: number) =>
  check(nombre, sql`${col} IS NULL OR char_length(${col}) <= ${sql.raw(String(max))}`);
const largo = (nombre: string, col: unknown, min: number, max: number) =>
  check(nombre, sql`char_length(btrim(${col})) BETWEEN ${sql.raw(String(min))} AND ${sql.raw(String(max))}`);

export const tipoVendedor = pgEnum('tipo_vendedor', ['casa', 'revendedora', 'consignacion']);
export const estadoPieza = pgEnum('estado_pieza', [
  'disponible',
  'en_exhibidor',
  'apartada',
  'vendida',
  'regalo',
  'defecto',
  'guardada',
]);
export const tipoMovimiento = pgEnum('tipo_movimiento', [
  'alta',
  'envio_exhibidor',
  'regreso',
  'venta',
  'cancelacion_venta',
  'cambio_estado',
  'correccion',
  // Plan 3: al entrar a un pedido y al salir de él (cancelar o quitar). 'venta' ya existía.
  'apartado',
  'liberacion',
  // Plan 3.1: custodia de vendedora (D-9) y devolución de una pieza vendida (D-17).
  'entrega_vendedora',
  'regreso_vendedora',
  'devolucion',
]);
export const estadoExhibidor = pgEnum('estado_exhibidor', ['abierto', 'cerrado']);

// Catálogos en su propia tabla (3FN). Los índices únicos por nombre normalizado (kz_normalizar) viven en
// 0003_inventario_reglas.sql: necesitan la función SQL, que se crea en esa misma migración.
export const categoria = pgTable(
  'categoria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    // Bloqueo optimista del renombrado (Plan 2.1); updated_at por trigger (0009).
    version: integer('version').notNull().default(1),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [largo('categoria_nombre_largo', t.nombre, 1, 80)],
);
export const material = pgTable(
  'material',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    // Bloqueo optimista del renombrado (Plan 2.1); updated_at por trigger (0009).
    version: integer('version').notNull().default(1),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [largo('material_nombre_largo', t.nombre, 1, 80)],
);
export const proveedor = pgTable(
  'proveedor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    // Bloqueo optimista del renombrado (Plan 2.1); updated_at por trigger (0009).
    version: integer('version').notNull().default(1),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [largo('proveedor_nombre_largo', t.nombre, 1, 80)],
);

export const vendedor = pgTable(
  'vendedor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),
    tipo: tipoVendedor('tipo').notNull(),
    comisionPct: numeric('comision_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    activo: boolean('activo').notNull().default(true),
    version: integer('version').notNull().default(1),
    ...tiempos,
  },
  (t) => [
    largo('vendedor_nombre_largo', t.nombre, 1, 80),
    check('vendedor_comision_rango', sql`${t.comisionPct} >= 0 AND ${t.comisionPct} <= 100`),
  ],
);

export const cliente = pgTable(
  'cliente',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),
    referencia: text('referencia'),
    telefono: text('telefono'),
    cumpleanos: date('cumpleanos'),
    redSocial: text('red_social'),
    usuarioRed: text('usuario_red'),
    vendedorHabitualId: uuid('vendedor_habitual_id').references(() => vendedor.id),
    notas: text('notas').notNull().default(''),
    version: integer('version').notNull().default(1),
    ...tiempos,
  },
  (t) => [
    largo('cliente_nombre_largo', t.nombre, 1, 120),
    index('cliente_vendedor_habitual_idx').on(t.vendedorHabitualId),
    maxLargo('cliente_referencia_largo', t.referencia, 120),
    maxLargo('cliente_telefono_largo', t.telefono, 30),
    maxLargo('cliente_red_social_largo', t.redSocial, 40),
    maxLargo('cliente_usuario_red_largo', t.usuarioRed, 80),
    check('cliente_notas_largo', sql`char_length(${t.notas}) <= 2000`),
  ],
);

export const exhibidor = pgTable(
  'exhibidor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendedorId: uuid('vendedor_id')
      .notNull()
      .references(() => vendedor.id),
    nombre: text('nombre').notNull(),
    fechaEnvio: date('fecha_envio').notNull(),
    estado: estadoExhibidor('estado').notNull().default('abierto'),
    cerradoAt: ts('cerrado_at'),
    version: integer('version').notNull().default(1),
    ...tiempos,
  },
  (t) => [
    largo('exhibidor_nombre_largo', t.nombre, 1, 120),
    index('exhibidor_vendedor_idx').on(t.vendedorId),
    // Desnormalización documentada: estado y cerrado_at deben decir lo mismo.
    check('exhibidor_cierre_coherente', sql`(${t.estado} = 'cerrado') = (${t.cerradoAt} IS NOT NULL)`),
  ],
);

export const pieza = pgTable(
  'pieza',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: text('codigo').notNull(),
    categoriaId: uuid('categoria_id')
      .notNull()
      .references(() => categoria.id),
    materialId: uuid('material_id').references(() => material.id),
    proveedorId: uuid('proveedor_id').references(() => proveedor.id),
    descripcion: text('descripcion').notNull(),
    costo: numeric('costo', { precision: 12, scale: 2 }).notNull().default('0'),
    precio: numeric('precio', { precision: 12, scale: 2 }).notNull(),
    fechaAlta: date('fecha_alta').notNull(),
    fotoPath: text('foto_path'),
    // Plan 2.2 (R-38): clave de la foto vigente; una nueva por subida (rutas inmutables en Blob).
    // foto_path (Plan 1) queda obsoleta: nunca se usó; se borra en una migración contract futura.
    imagenClave: uuid('imagen_clave'),
    // Desnormalización documentada: estado actual (derivable del historial), protegido por trigger y CHECK.
    estado: estadoPieza('estado').notNull().default('disponible'),
    exhibidorId: uuid('exhibidor_id').references(() => exhibidor.id),
    // Plan 3.1 (D-8): vendedora que tiene la pieza (sin exhibidor). Desnormalización documentada como
    // exhibidor_id: la protegen el trigger pieza_transicion v5 (0017) y los CHECK de abajo.
    vendedorCustodiaId: uuid('vendedor_custodia_id').references(() => vendedor.id),
    version: integer('version').notNull().default(1),
    ...tiempos,
  },
  (t) => [
    uniqueIndex('pieza_codigo_uq').on(t.codigo),
    // Plan 2.2: una clave de foto pertenece a una sola pieza (NULL se repite sin problema).
    uniqueIndex('pieza_imagen_clave_uq').on(t.imagenClave),
    index('pieza_estado_idx').on(t.estado),
    index('pieza_categoria_idx').on(t.categoriaId),
    index('pieza_material_idx').on(t.materialId),
    index('pieza_proveedor_idx').on(t.proveedorId),
    index('pieza_exhibidor_idx').on(t.exhibidorId),
    check('pieza_codigo_formato', sql`${t.codigo} ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'`),
    largo('pieza_descripcion_largo', t.descripcion, 1, 300),
    check('pieza_montos', sql`${t.costo} >= 0 AND ${t.precio} >= 0`),
    check('pieza_exhibidor_coherente', sql`${t.estado} <> 'en_exhibidor' OR ${t.exhibidorId} IS NOT NULL`),
    // "apartada" conserva el exhibidor para que una venta cancelada devuelva la pieza a él.
    check(
      'pieza_exhibidor_solo_si_aplica',
      sql`${t.estado} IN ('en_exhibidor', 'apartada') OR ${t.exhibidorId} IS NULL`,
    ),
    maxLargo('pieza_foto_path_largo', t.fotoPath, 500),
    index('pieza_vendedor_custodia_idx').on(t.vendedorCustodiaId),
    check('pieza_una_ubicacion', sql`num_nonnulls(${t.exhibidorId}, ${t.vendedorCustodiaId}) <= 1`),
    // Como "apartada" conserva el exhibidor, también conserva la vendedora: cancelar la devuelve con ella (D-8).
    check(
      'pieza_custodia_solo_si_aplica',
      sql`${t.estado} IN ('disponible', 'apartada') OR ${t.vendedorCustodiaId} IS NULL`,
    ),
  ],
);

export const movimientoPieza = pgTable(
  'movimiento_pieza',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Orden total del historial: los movimientos de una misma transacción comparten now().
    orden: bigserial('orden', { mode: 'number' }).notNull(),
    piezaId: uuid('pieza_id')
      .notNull()
      .references(() => pieza.id),
    tipo: tipoMovimiento('tipo').notNull(),
    deEstado: estadoPieza('de_estado'),
    aEstado: estadoPieza('a_estado').notNull(),
    exhibidorId: uuid('exhibidor_id').references(() => exhibidor.id),
    // Plan 3: FK con índice. La importación circular es segura: references() se evalúa perezosamente.
    pedidoId: uuid('pedido_id').references((): AnyPgColumn => pedido.id),
    nota: text('nota'),
    // Quién hizo el movimiento (Plan 2.1). Nullable: las filas anteriores no lo tienen.
    adminId: uuid('admin_id').references(() => admin.id),
    fecha: ts('fecha').notNull().defaultNow(),
    // Plan 3.1: vendedora de la entrega/regreso (D-9), de la venta y del cambio manual (D-10, D-12).
    vendedorId: uuid('vendedor_id').references(() => vendedor.id),
  },
  (t) => [
    index('movimiento_pieza_pieza_idx').on(t.piezaId, t.orden),
    index('movimiento_pieza_exhibidor_idx').on(t.exhibidorId),
    check('movimiento_nota_largo', sql`${t.nota} IS NULL OR char_length(${t.nota}) <= 200`),
    index('movimiento_pieza_admin_idx').on(t.adminId),
    index('movimiento_pieza_pedido_idx').on(t.pedidoId),
    index('movimiento_pieza_vendedor_idx').on(t.vendedorId),
    // `tipo::text` y no el literal del enum: 'correccion' se agrega en esta misma tanda de migraciones (55P04).
    check(
      'movimiento_correccion_completa',
      sql`${t.tipo}::text <> 'correccion' OR (${t.adminId} IS NOT NULL AND char_length(btrim(coalesce(${t.nota}, ''))) >= 1)`,
    ),
  ],
);
