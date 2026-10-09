import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (nombre: string) => timestamp(nombre, { withTimezone: true });

export const rolAdmin = pgEnum('rol_admin', ['admin']);
export const nivelSesion = pgEnum('nivel_sesion', ['pre_mfa', 'completa']);
export const eventoAcceso = pgEnum('evento_acceso', [
  'login_ok',
  'password_fallido',
  'totp_fallido',
  'bloqueado',
  'logout',
  'logout_todos',
  'codigo_recuperacion_usado',
]);

export const admin = pgTable(
  'admin',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    totpSecretCifrado: text('totp_secret_cifrado').notNull(),
    // Último paso TOTP aceptado: impide reutilizar el mismo código dentro de su ventana.
    totpUltimoPaso: bigint('totp_ultimo_paso', { mode: 'number' }).notNull().default(0),
    // Roles modelados desde el inicio aunque hoy solo exista uno (deuda consciente, lecciones §5).
    rol: rolAdmin('rol').notNull().default('admin'),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('admin_email_uq').on(sql`lower(${t.email})`)],
);

export const codigoRecuperacion = pgTable(
  'codigo_recuperacion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admin.id),
    hash: text('hash').notNull(),
    usadoAt: ts('usado_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('codigo_recuperacion_hash_uq').on(t.hash)],
);

export const sesion = pgTable(
  'sesion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admin.id),
    nivel: nivelSesion('nivel').notNull(),
    expiraAt: ts('expira_at').notNull(),
    ultimoUsoAt: ts('ultimo_uso_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revocadaAt: ts('revocada_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sesion_token_hash_uq').on(t.tokenHash), index('sesion_admin_idx').on(t.adminId)],
);

export const accesoLog = pgTable(
  'acceso_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    evento: eventoAcceso('evento').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('acceso_log_email_fecha_idx').on(t.email, t.createdAt),
    index('acceso_log_fecha_idx').on(t.createdAt),
  ],
);

export const idempotencia = pgTable('idempotencia', {
  key: uuid('key').primaryKey(),
  operacion: text('operacion').notNull(),
  payloadHash: text('payload_hash').notNull(),
  resultado: jsonb('resultado'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
