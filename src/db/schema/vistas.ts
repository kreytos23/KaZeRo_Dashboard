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
