import { sql } from 'drizzle-orm';
import { conDbUrl } from '@/db/pool';

export const urlApp = () => process.env.DATABASE_URL!;
export const urlOwner = () => process.env.DATABASE_URL_OWNER!;
export const llaveTotp = () => process.env.KAZERO_TOTP_KEY!;

/** Limpia inventario, personas y auth. Solo el dueño puede TRUNCATE. */
export function truncarTodo() {
  return conDbUrl(urlOwner(), (db) =>
    db.execute(sql`TRUNCATE auditoria_campo, auditoria, saldo_favor_mov, aplicacion_pago, pago, pedido_item, pedido, movimiento_pieza, pieza, exhibidor, cliente, vendedor, categoria, material, proveedor,
      codigo_recuperacion, sesion, acceso_log, idempotencia, admin RESTART IDENTITY CASCADE`),
  );
}

/** Limpia las tablas de auth. Solo el dueño puede TRUNCATE (kazero_app no). */
export function truncarAuth() {
  return conDbUrl(urlOwner(), (db) =>
    db.execute(
      sql`TRUNCATE codigo_recuperacion, sesion, acceso_log, idempotencia, admin RESTART IDENTITY CASCADE`,
    ),
  );
}

/** Admin mínimo (como dueño) para las FK de la bitácora y de los movimientos. */
export async function adminDePrueba(email = 'auditor@kazero.test'): Promise<string> {
  const r = await conDbUrl(urlOwner(), (db) =>
    db.execute<{ id: string }>(
      sql`INSERT INTO admin (email, password_hash, totp_secret_cifrado) VALUES (${email}, 'h', 'c') RETURNING id`,
    ),
  );
  return r.rows[0]!.id;
}
