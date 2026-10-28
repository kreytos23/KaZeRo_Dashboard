import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgView,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { entidadAuditoria } from './auditoria';
import { estadoExhibidor, estadoPieza, tipoMovimiento, tipoVendedor } from './inventario';
import type { Ubicacion } from '../../domain/ubicacion';
import { estadoPedido, metodoPago, motivoSinLealtad, tipoSaldoFavor } from './pedidos';

// Vistas de SOLO LECTURA creadas en 0003_inventario_reglas.sql (security_invoker, columnas explícitas).
// `.existing()`: drizzle-kit no las genera ni las borra. Toda lectura de servicios va por aquí.
const ts = (n: string) => timestamp(n, { withTimezone: true });

export const vCatalogo = pgView('v_catalogo', {
  tipo: text('tipo').$type<'categoria' | 'material' | 'proveedor'>().notNull(),
  id: uuid('id').notNull(),
  nombre: text('nombre').notNull(),
  version: integer('version').notNull(),
}).existing();

export const vVendedor = pgView('v_vendedor', {
  id: uuid('id').notNull(),
  nombre: text('nombre').notNull(),
  tipo: tipoVendedor('tipo').notNull(),
  comisionPct: numeric('comision_pct').notNull(),
  activo: boolean('activo').notNull(),
  version: integer('version').notNull(),
}).existing();

export const vCliente = pgView('v_cliente', {
  id: uuid('id').notNull(),
  nombre: text('nombre').notNull(),
  referencia: text('referencia'),
  telefono: text('telefono'),
  cumpleanos: date('cumpleanos'),
  redSocial: text('red_social'),
  usuarioRed: text('usuario_red'),
  vendedorHabitualId: uuid('vendedor_habitual_id'),
  vendedorHabitualNombre: text('vendedor_habitual_nombre'),
  notas: text('notas').notNull(),
  version: integer('version').notNull(),
}).existing();

export const vPieza = pgView('v_pieza', {
  id: uuid('id').notNull(),
  codigo: text('codigo').notNull(),
  descripcion: text('descripcion').notNull(),
  costo: numeric('costo').notNull(),
  precio: numeric('precio').notNull(),
  fechaAlta: date('fecha_alta').notNull(),
  estado: estadoPieza('estado').notNull(),
  version: integer('version').notNull(),
  categoriaId: uuid('categoria_id').notNull(),
  categoriaNombre: text('categoria_nombre').notNull(),
  materialId: uuid('material_id'),
  materialNombre: text('material_nombre'),
  proveedorId: uuid('proveedor_id'),
  proveedorNombre: text('proveedor_nombre'),
  exhibidorId: uuid('exhibidor_id'),
  exhibidorNombre: text('exhibidor_nombre'),
  imagenClave: uuid('imagen_clave'),
  // Plan 3.1 (0017), al final: custodia de vendedora y ubicación derivada (D-8).
  vendedorCustodiaId: uuid('vendedor_custodia_id'),
  vendedorCustodiaNombre: text('vendedor_custodia_nombre'),
  ubicacion: text('ubicacion').$type<Ubicacion>().notNull(),
}).existing();

export const vMovimientoPieza = pgView('v_movimiento_pieza', {
  id: uuid('id').notNull(),
  orden: bigint('orden', { mode: 'number' }).notNull(),
  piezaId: uuid('pieza_id').notNull(),
  tipo: tipoMovimiento('tipo').notNull(),
  deEstado: estadoPieza('de_estado'),
  aEstado: estadoPieza('a_estado').notNull(),
  nota: text('nota'),
  fecha: ts('fecha').notNull(),
  exhibidorId: uuid('exhibidor_id'),
  exhibidorNombre: text('exhibidor_nombre'),
  adminId: uuid('admin_id'),
  adminEmail: text('admin_email'),
  exhibidorEstado: estadoExhibidor('exhibidor_estado'),
  // Plan 3 (0013), al final.
  pedidoId: uuid('pedido_id'),
  pedidoFolio: integer('pedido_folio'),
  // Plan 3.1 (0017), al final.
  vendedorId: uuid('vendedor_id'),
  vendedorNombre: text('vendedor_nombre'),
}).existing();

export const vExhibidor = pgView('v_exhibidor', {
  id: uuid('id').notNull(),
  nombre: text('nombre').notNull(),
  fechaEnvio: date('fecha_envio').notNull(),
  estado: estadoExhibidor('estado').notNull(),
  version: integer('version').notNull(),
  vendedorId: uuid('vendedor_id').notNull(),
  vendedorNombre: text('vendedor_nombre').notNull(),
  piezasActuales: integer('piezas_actuales').notNull(),
  // Plan 3 (0013): apartadas en un pedido que conservan este exhibidor.
  piezasApartadas: integer('piezas_apartadas').notNull(),
  // Plan 4a (0021), al final: dinero del exhibidor (E-5).
  cobrado: numeric('cobrado').notNull(),
  entregado: numeric('entregado').notNull(),
  ajustes: numeric('ajustes').notNull(),
  porEntregar: numeric('por_entregar').notNull(),
}).existing();

// Creada en 0007_admins_grants.sql: solo columnas no sensibles de admin.
export const vAdmin = pgView('v_admin', {
  id: uuid('id').notNull(),
  email: text('email').notNull(),
  createdAt: ts('created_at').notNull(),
}).existing();

// Creada en 0009_auditoria_reglas.sql: una fila por campo cambiado, con el correo del admin (sin N+1).
export const vAuditoria = pgView('v_auditoria', {
  auditoriaId: uuid('auditoria_id').notNull(),
  orden: bigint('orden', { mode: 'number' }).notNull(),
  entidad: entidadAuditoria('entidad').notNull(),
  entidadId: uuid('entidad_id').notNull(),
  motivo: text('motivo'),
  fecha: ts('fecha').notNull(),
  adminEmail: text('admin_email').notNull(),
  posicion: smallint('posicion').notNull(),
  campo: text('campo').notNull(),
  antes: text('antes'),
  despues: text('despues'),
}).existing();

// Creadas en 0013_pedidos_reglas.sql (Plan 3). Los numeric llegan como string.
export const vPedido = pgView('v_pedido', {
  id: uuid('id').notNull(),
  folio: integer('folio').notNull(),
  fecha: date('fecha').notNull(),
  estado: estadoPedido('estado').notNull(),
  version: integer('version').notNull(),
  clienteId: uuid('cliente_id').notNull(),
  clienteNombre: text('cliente_nombre').notNull(),
  vendedorId: uuid('vendedor_id').notNull(),
  vendedorNombre: text('vendedor_nombre').notNull(),
  cuentaTarjeta: boolean('cuenta_tarjeta').notNull(),
  cicloTarjeta: integer('ciclo_tarjeta'),
  posicionTarjeta: integer('posicion_tarjeta'),
  descuentoLealtadPct: numeric('descuento_lealtad_pct').notNull(),
  sinLealtadMotivo: motivoSinLealtad('sin_lealtad_motivo'),
  descuentoManualMonto: numeric('descuento_manual_monto').notNull(),
  descuentoManualMotivo: text('descuento_manual_motivo'),
  subtotal: numeric('subtotal').notNull(),
  descuentoLealtadMonto: numeric('descuento_lealtad_monto').notNull(),
  total: numeric('total').notNull(),
  pagado: numeric('pagado').notNull(),
  saldo: numeric('saldo').notNull(),
  piezas: integer('piezas').notNull(),
  notas: text('notas').notNull(),
  createdAt: ts('created_at').notNull(),
  liquidadoAt: ts('liquidado_at'),
  canceladoAt: ts('cancelado_at'),
  cancelacionMotivo: text('cancelacion_motivo'),
  // Plan 3.1 (0017), al final: lo devuelto a saldo a favor.
  devuelto: numeric('devuelto').notNull(),
}).existing();

export const vPedidoItem = pgView('v_pedido_item', {
  id: uuid('id').notNull(),
  pedidoId: uuid('pedido_id').notNull(),
  folio: integer('folio').notNull(),
  pedidoEstado: estadoPedido('pedido_estado').notNull(),
  clienteId: uuid('cliente_id').notNull(),
  clienteNombre: text('cliente_nombre').notNull(),
  piezaId: uuid('pieza_id').notNull(),
  codigo: text('codigo').notNull(),
  descripcion: text('descripcion').notNull(),
  piezaEstado: estadoPieza('pieza_estado').notNull(),
  exhibidorId: uuid('exhibidor_id'),
  precioLista: numeric('precio_lista').notNull(),
  precioFinal: numeric('precio_final').notNull(),
  vigente: boolean('vigente').notNull(),
  quitadoAt: ts('quitado_at'),
  // Plan 3.1 (0017), al final: la devolución de la línea, si la hubo.
  devolucionId: uuid('devolucion_id'),
  devolucionFecha: date('devolucion_fecha'),
  devolucionMotivo: text('devolucion_motivo'),
  devolucionMonto: numeric('devolucion_monto'),
}).existing();

export const vAplicacionPago = pgView('v_aplicacion_pago', {
  id: uuid('id').notNull(),
  pedidoId: uuid('pedido_id').notNull(),
  pagoId: uuid('pago_id').notNull(),
  monto: numeric('monto').notNull(),
  fecha: date('fecha').notNull(),
  anuladaAt: ts('anulada_at'),
  metodo: metodoPago('metodo').notNull(),
  nota: text('nota'),
  pagadorTipo: text('pagador_tipo').$type<'cliente' | 'vendedor'>().notNull(),
  pagadorNombre: text('pagador_nombre').notNull(),
  createdAt: ts('created_at').notNull(),
}).existing();

export const vSaldoFavor = pgView('v_saldo_favor', {
  clienteId: uuid('cliente_id'),
  vendedorId: uuid('vendedor_id'),
  saldo: numeric('saldo').notNull(),
}).existing();

// Creada en 0017_ajustes_reunion_reglas.sql (Plan 3.1): historial del saldo a favor con su origen.
export const vSaldoFavorMov = pgView('v_saldo_favor_mov', {
  id: uuid('id').notNull(),
  clienteId: uuid('cliente_id'),
  vendedorId: uuid('vendedor_id'),
  tipo: tipoSaldoFavor('tipo').notNull(),
  monto: numeric('monto').notNull(),
  fecha: date('fecha').notNull(),
  pedidoId: uuid('pedido_id'),
  pedidoFolio: integer('pedido_folio'),
  aplicacionPagoId: uuid('aplicacion_pago_id'),
  devolucionId: uuid('devolucion_id'),
  devolucionMotivo: text('devolucion_motivo'),
  nota: text('nota'),
  adminId: uuid('admin_id'),
  adminEmail: text('admin_email'),
  createdAt: ts('created_at').notNull(),
}).existing();
