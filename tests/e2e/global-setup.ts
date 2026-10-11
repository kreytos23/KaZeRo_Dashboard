import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { conDbUrl } from '../../src/db/pool';
import { sesion } from '../../src/db/schema';
import { crearAdmin } from '../../src/server/auth/admin';
import { nuevoToken } from '../../src/server/auth/tokens';
import { verificarRamaPrueba } from '../../scripts/lib/rama-prueba';
import { RUTA_DATOS, RUTA_DATOS_REGEN, RUTA_ESTADO, RUTA_ESTADO_REGEN, RUTA_PASO } from './utilidades';

/** Sesión completa creada directo en BD + storageState con su cookie (así no se repite el login con TOTP). */
async function sesionPrecargada(adminId: string, ruta: string) {
  const { token, hash } = nuevoToken();
  await conDbUrl(process.env.DATABASE_URL_OWNER!, (db) =>
    db.insert(sesion).values({
      tokenHash: hash,
      adminId,
      nivel: 'completa',
      expiraAt: new Date(Date.now() + 86_400_000),
      ultimoUsoAt: new Date(),
    }),
  );
  writeFileSync(
    ruta,
    JSON.stringify({
      // __Host- exige Secure y Path=/, sin Domain: se fija domain/path para que quede host-only.
      cookies: [
        {
          name: '__Host-kz_sesion',
          value: token,
          domain: 'localhost',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 86_400,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  );
}

export default async function globalSetup() {
  verificarRamaPrueba(process.env);
  const email = 'e2e@kazero.test';
  const password = randomBytes(18).toString('base64url');
  const regen = { email: 'regen@kazero.test', password: randomBytes(18).toString('base64url') };
  const [a, r] = await conDbUrl(process.env.DATABASE_URL_OWNER!, async (db) => {
    await db.execute(
      sql`TRUNCATE auditoria_campo, auditoria, movimiento_pieza, pieza, exhibidor, cliente, vendedor, categoria, material, proveedor,
        codigo_recuperacion, sesion, acceso_log, idempotencia, admin RESTART IDENTITY CASCADE`,
    );
    const key = process.env.KAZERO_TOTP_KEY!;
    return [await crearAdmin(db, { email, password }, key), await crearAdmin(db, regen, key)] as const;
  });
  mkdirSync('playwright/.datos', { recursive: true });
  rmSync(RUTA_PASO, { force: true });
  writeFileSync(RUTA_DATOS, JSON.stringify({ email, password, secretoTotp: a.secretoTotp }));
  writeFileSync(RUTA_DATOS_REGEN, JSON.stringify(regen));
  await sesionPrecargada(a.id, RUTA_ESTADO);
  await sesionPrecargada(r.id, RUTA_ESTADO_REGEN);
}
