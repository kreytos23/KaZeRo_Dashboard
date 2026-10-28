import { sql } from 'drizzle-orm';
import {
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
} from 'drizzle-orm/pg-core';
import { admin } from './auth';
import { cliente, exhibidor, pieza, vendedor } from './inventario';

// Plan 3. Reglas que no caben en un CHECK (máquina de estados, auditoría, privilegios por columna, vistas) en
// drizzle/0013_pedidos_reglas.sql.
const ts = (nombre: string) => timestamp(nombre, { withTimezone: true });
const dinero = (nombre: string) => numeric(nombre, { precision: 12, scale: 2 });

export const estadoPedido = pgEnum('estado_pedido', ['abierto', 'liquidado', 'cancelado']);
export const motivoSinLealtad = pgEnum('motivo_sin_lealtad', ['saldo_pendiente']);
// Plan 3.1 (D-20): 'saldo_favor' = la clienta paga con su saldo a favor.
export const metodoPago = pgEnum('metodo_pago', ['transferencia', 'efectivo', 'otro', 'saldo_favor']);
// 'sobrante' lo usa el Plan 4. Plan 3.1: 'uso' (D-20), 'devolucion' (D-16) y 'retiro' en efectivo (D-21).
export const tipoSaldoFavor = pgEnum('tipo_saldo_favor', [
  'cancelacion',
  'sobrante',
  'uso',
  'devolucion',
  'retiro',
]);

export const pedido = pgTable(
  'pedido',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // BY DEFAULT: el Plan 7 inserta los folios históricos del Excel y luego hace setval (D-2).
    folio: integer('folio').notNull().generatedByDefaultAsIdentity(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id),
    vendedorId: uuid('vendedor_id')
      .notNull()
      .references(() => vendedor.id),
    fecha: date('fecha').notNull(),
    // Desnormalización documentada: protegida por el trigger pedido_transicion y los CHECK de coherencia.
    estado: estadoPedido('estado').notNull().default('abierto'),
    cuentaTarjeta: boolean('cuenta_tarjeta').notNull().default(true),
    cicloTarjeta: integer('ciclo_tarjeta'),
    posicionTarjeta: integer('posicion_tarjeta'),
    descuentoLealtadPct: numeric('descuento_lealtad_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    sinLealtadMotivo: motivoSinLealtad('sin_lealtad_motivo'),
    descuentoManualMonto: dinero('descuento_manual_monto').notNull().default('0'),
    descuentoManualMotivo: text('descuento_manual_motivo'),
    // Calculado y guardado al confirmar (spec §4); subtotal y lealtad se derivan en v_pedido.
    total: dinero('total').notNull(),
    notas: text('notas').notNull().default(''),
    liquidadoAt: ts('liquidado_at'),
    canceladoAt: ts('cancelado_at'),
    cancelacionMotivo: text('cancelacion_motivo'),
    // D-21: quién lo creó (inmutable). Los cambios posteriores los registra kz_auditar con su admin.
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admin.id),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pedido_folio_uq').on(t.folio),
    index('pedido_cliente_idx').on(t.clienteId, t.fecha),
    index('pedido_vendedor_idx').on(t.vendedorId),
    index('pedido_estado_idx').on(t.estado),
    index('pedido_admin_idx').on(t.adminId),
    // R-23 / R-24: una posición por cliente y ciclo entre pedidos no cancelados que cuentan.
    uniqueIndex('pedido_tarjeta_posicion_uq')
      .on(t.clienteId, t.cicloTarjeta, t.posicionTarjeta)
      .where(sql`${t.estado} <> 'cancelado' AND ${t.cuentaTarjeta}`),
    check('pedido_folio_positivo', sql`${t.folio} > 0`),
    check(
      'pedido_tarjeta_coherente',
      sql`(${t.cuentaTarjeta} AND ${t.cicloTarjeta} IS NOT NULL AND ${t.posicionTarjeta} IS NOT NULL)
        OR (NOT ${t.cuentaTarjeta} AND ${t.cicloTarjeta} IS NULL AND ${t.posicionTarjeta} IS NULL
            AND ${t.descuentoLealtadPct} = 0 AND ${t.sinLealtadMotivo} IS NULL)`,
    ),
    // R-21: 10 posiciones. Si la regla cambia (Plan 5, Config), una migración amplía este CHECK.
    check('pedido_posicion_rango', sql`${t.cicloTarjeta} >= 1 AND ${t.posicionTarjeta} BETWEEN 1 AND 10`),
    check('pedido_lealtad_pct_rango', sql`${t.descuentoLealtadPct} >= 0 AND ${t.descuentoLealtadPct} <= 100`),
    check('pedido_sin_lealtad_coherente', sql`${t.sinLealtadMotivo} IS NULL OR ${t.descuentoLealtadPct} = 0`),
    // `IS NOT NULL` explícito: con motivo NULL, char_length(...) BETWEEN da NULL y un CHECK con NULL pasa.
    check(
      'pedido_descuento_manual',
      sql`(${t.descuentoManualMonto} = 0 AND ${t.descuentoManualMotivo} IS NULL)
        OR (${t.descuentoManualMonto} > 0 AND ${t.descuentoManualMotivo} IS NOT NULL
            AND char_length(btrim(${t.descuentoManualMotivo})) BETWEEN 1 AND 200)`,
    ),
    check('pedido_total_no_negativo', sql`${t.total} >= 0`),
    check('pedido_notas_largo', sql`char_length(${t.notas}) <= 500`),
    check('pedido_liquidado_coherente', sql`(${t.estado} = 'liquidado') = (${t.liquidadoAt} IS NOT NULL)`),
    check(
      'pedido_cancelado_coherente',
      sql`(${t.estado} = 'cancelado') = (${t.canceladoAt} IS NOT NULL)
        AND (${t.estado} = 'cancelado') = (${t.cancelacionMotivo} IS NOT NULL)
        AND (${t.cancelacionMotivo} IS NULL OR char_length(btrim(${t.cancelacionMotivo})) BETWEEN 1 AND 200)`,
    ),
  ],
);

export const pedidoItem = pgTable(
  'pedido_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedido.id),
    piezaId: uuid('pieza_id')
      .notNull()
      .references(() => pieza.id),
    // R-11: copia del precio al agregarla; cambiar después el precio de la pieza no la toca.
    precioLista: dinero('precio_lista').notNull(),
    precioFinal: dinero('precio_final').notNull(),
    // Desnormalización documentada (D-5): false si el pedido se canceló o la línea se quitó.
    vigente: boolean('vigente').notNull().default(true),
    quitadoAt: ts('quitado_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('pedido_item_pedido_idx').on(t.pedidoId),
    index('pedido_item_pieza_idx').on(t.piezaId),
    // R-05: una pieza en un solo pedido vigente.
    uniqueIndex('pedido_item_pieza_activa_uq')
      .on(t.piezaId)
      .where(sql`${t.vigente}`),
    check('pedido_item_precios', sql`${t.precioFinal} >= 0 AND ${t.precioFinal} <= ${t.precioLista}`),
    check('pedido_item_quitado_coherente', sql`${t.quitadoAt} IS NULL OR NOT ${t.vigente}`),
  ],
);

export const pago = pgTable(
  'pago',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    fecha: date('fecha').notNull(),
    monto: dinero('monto').notNull(),
    metodo: metodoPago('metodo').notNull(),
    // D-4: dos FK en vez de pagador_tipo + pagador_id, para que la BD garantice la integridad.
    pagadorClienteId: uuid('pagador_cliente_id').references(() => cliente.id),
    pagadorVendedorId: uuid('pagador_vendedor_id').references(() => vendedor.id),
    nota: text('nota'),
    // D-21: quién registró el pago (los pagos no se editan: se anulan sus aplicaciones).
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admin.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    // Plan 4a (E-4): lo cobró este exhibidor (queda «por entregar»). El trigger de 0021 exige, al aplicarlo, un
    // exhibidor abierto de la vendedora del pedido.
    exhibidorId: uuid('exhibidor_id').references(() => exhibidor.id),
  },
  (t) => [
    uniqueIndex('pago_idempotency_key_uq').on(t.idempotencyKey),
    index('pago_exhibidor_idx').on(t.exhibidorId),
    index('pago_pagador_cliente_idx').on(t.pagadorClienteId),
    index('pago_pagador_vendedor_idx').on(t.pagadorVendedorId),
    index('pago_admin_idx').on(t.adminId),
    check('pago_monto_positivo', sql`${t.monto} > 0`),
    check('pago_un_pagador', sql`num_nonnulls(${t.pagadorClienteId}, ${t.pagadorVendedorId}) = 1`),
    check('pago_nota_largo', sql`${t.nota} IS NULL OR char_length(${t.nota}) <= 200`),
    // D-20. `::text`: 'saldo_favor' se agrega en esta misma tanda de migraciones (55P04).
    check(
      'pago_saldo_favor_cliente',
      sql`${t.metodo}::text <> 'saldo_favor' OR ${t.pagadorClienteId} IS NOT NULL`,
    ),
    // Plan 4a: usar saldo a favor no es dinero que el exhibidor cobró (no se le pide entregarlo).
    check('pago_exhibidor_sin_saldo', sql`${t.exhibidorId} IS NULL OR ${t.metodo}::text <> 'saldo_favor'`),
  ],
);

export const aplicacionPago = pgTable(
  'aplicacion_pago',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pagoId: uuid('pago_id')
      .notNull()
      .references(() => pago.id),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedido.id),
    monto: dinero('monto').notNull(),
    // R-35: fecha de cobro = fecha del pago; define el corte (Plan 5).
    fecha: date('fecha').notNull(),
    // Las reversiones no borran (spec §7.1): única columna actualizable por la app.
    anuladaAt: ts('anulada_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('aplicacion_pago_pago_idx').on(t.pagoId),
    index('aplicacion_pago_pedido_idx').on(t.pedidoId),
    check('aplicacion_pago_monto_positivo', sql`${t.monto} > 0`),
  ],
);

// Plan 3.1 (D-13): devolución de la pieza de una línea de un pedido liquidado. Solo inserción; el trigger
// devolucion_validar (0017) exige pedido liquidado, línea vigente, pieza vendida, montos y fecha.
export const devolucion = pgTable(
  'devolucion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pedidoItemId: uuid('pedido_item_id')
      .notNull()
      .references(() => pedidoItem.id),
    fecha: date('fecha').notNull(),
    motivo: text('motivo').notNull(),
    monto: dinero('monto').notNull(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admin.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Una línea se devuelve una sola vez.
    uniqueIndex('devolucion_pedido_item_uq').on(t.pedidoItemId),
    index('devolucion_admin_idx').on(t.adminId),
    check('devolucion_monto_positivo', sql`${t.monto} > 0`),
    check('devolucion_motivo_largo', sql`char_length(btrim(${t.motivo})) BETWEEN 1 AND 200`),
  ],
);

export const saldoFavorMov = pgTable(
  'saldo_favor_mov',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id').references(() => cliente.id),
    vendedorId: uuid('vendedor_id').references(() => vendedor.id),
    tipo: tipoSaldoFavor('tipo').notNull(),
    monto: dinero('monto').notNull(),
    pedidoId: uuid('pedido_id').references(() => pedido.id),
    fecha: date('fecha').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    // Plan 3.1: origen del movimiento (únicos: un uso por aplicación, un saldo por devolución), quién y por qué.
    aplicacionPagoId: uuid('aplicacion_pago_id').references(() => aplicacionPago.id),
    devolucionId: uuid('devolucion_id').references(() => devolucion.id),
    // Anulable: los movimientos anteriores al Plan 3.1 no lo tienen (D-22).
    adminId: uuid('admin_id').references(() => admin.id),
    nota: text('nota'),
  },
  (t) => [
    index('saldo_favor_mov_cliente_idx').on(t.clienteId),
    index('saldo_favor_mov_vendedor_idx').on(t.vendedorId),
    index('saldo_favor_mov_pedido_idx').on(t.pedidoId),
    uniqueIndex('saldo_favor_mov_aplicacion_uq').on(t.aplicacionPagoId),
    uniqueIndex('saldo_favor_mov_devolucion_uq').on(t.devolucionId),
    index('saldo_favor_mov_admin_idx').on(t.adminId),
    check('saldo_favor_un_titular', sql`num_nonnulls(${t.clienteId}, ${t.vendedorId}) = 1`),
    // El trigger saldo_favor_libro (0013; v2 en 0017) valida el origen y que el saldo nunca quede negativo.
    // D-22: versiones _v2 más permisivas que saldo_favor_signo (0012) y saldo_favor_pedido_requerido (0013),
    // que 0016/0017 eliminan. `tipo::text`: 'devolucion' y 'retiro' se agregan en esta misma tanda (55P04).
    // Entradas positivas (cancelación, sobrante, devolución), salidas negativas (uso, retiro).
    check(
      'saldo_favor_signo_v2',
      sql`(${t.tipo}::text IN ('uso', 'retiro') AND ${t.monto} < 0) OR (${t.tipo}::text NOT IN ('uso', 'retiro') AND ${t.monto} > 0)`,
    ),
    check(
      'saldo_favor_pedido_requerido_v2',
      sql`${t.tipo}::text IN ('sobrante', 'retiro') OR ${t.pedidoId} IS NOT NULL`,
    ),
    check(
      'saldo_favor_origen',
      sql`(${t.tipo}::text = 'uso') = (${t.aplicacionPagoId} IS NOT NULL) AND (${t.tipo}::text = 'devolucion') = (${t.devolucionId} IS NOT NULL)`,
    ),
    check(
      'saldo_favor_retiro_completo',
      sql`${t.tipo}::text <> 'retiro' OR (${t.adminId} IS NOT NULL AND char_length(btrim(coalesce(${t.nota}, ''))) BETWEEN 1 AND 200)`,
    ),
    check('saldo_favor_nota_largo', sql`${t.nota} IS NULL OR char_length(${t.nota}) <= 200`),
  ],
);
