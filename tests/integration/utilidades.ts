import { sql } from 'drizzle-orm';
import { conDbUrl } from '@/db/pool';

export const urlApp = () => process.env.DATABASE_URL!;
export const urlOwner = () => process.env.DATABASE_URL_OWNER!;
export const llaveTotp = () => process.env.KAZERO_TOTP_KEY!;

/** Limpia las tablas de auth. Solo el dueño puede TRUNCATE (kazero_app no). */
export function truncarAuth() {
  return conDbUrl(urlOwner(), (db) =>
    db.execute(
      sql`TRUNCATE codigo_recuperacion, sesion, acceso_log, idempotencia, admin RESTART IDENTITY CASCADE`,
    ),
  );
}
