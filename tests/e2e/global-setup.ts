import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { conDbUrl } from '../../src/db/pool';
import { crearAdmin } from '../../src/server/auth/admin';
import { verificarRamaPrueba } from '../../scripts/lib/rama-prueba';
import { RUTA_DATOS, RUTA_PASO } from './utilidades';

export default async function globalSetup() {
  verificarRamaPrueba(process.env);
  const email = 'e2e@kazero.test';
  const password = randomBytes(18).toString('base64url');
  const a = await conDbUrl(process.env.DATABASE_URL_OWNER!, async (db) => {
    await db.execute(
      sql`TRUNCATE codigo_recuperacion, sesion, acceso_log, idempotencia, admin RESTART IDENTITY CASCADE`,
    );
    return crearAdmin(db, { email, password }, process.env.KAZERO_TOTP_KEY!);
  });
  mkdirSync('playwright/.datos', { recursive: true });
  rmSync(RUTA_PASO, { force: true });
  writeFileSync(RUTA_DATOS, JSON.stringify({ email, password, secretoTotp: a.secretoTotp }));
}
