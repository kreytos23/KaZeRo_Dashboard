import { randomBytes } from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { configurarProxyLocal } from '../../src/db/proxy-local';
import { asignarPasswordApp, migrar } from './migrar';
import { PREFIJO_BASE_PRUEBA, verificarUrlPgDirecto } from './rama-prueba';

// Modo "Postgres directo" de scripts/test-neon.ts (guardas y motivo en rama-prueba.ts).
configurarProxyLocal();

/** test_<sufijo>[_wN]: solo [a-z0-9_], así que va entre comillas sin riesgo y cabe en 63 caracteres. */
export function nombresBases(sufijo: string, n: number): string[] {
  const limpio = sufijo.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const raiz = `${PREFIJO_BASE_PRUEBA}${limpio}`.slice(0, 58);
  return Array.from({ length: n }, (_, i) => (n === 1 ? raiz : `${raiz}_w${i + 1}`));
}

function conCredenciales(url: string, usuario: string, password: string, base: string) {
  const u = new URL(url);
  u.username = usuario;
  u.password = password;
  u.pathname = `/${base}`;
  return u.toString();
}

async function ejecutar(urlAdmin: string, sentencias: string[]) {
  const pool = new Pool({ connectionString: urlAdmin, max: 1 });
  pool.on('error', () => {});
  try {
    for (const s of sentencias) await pool.query(s);
  } finally {
    await pool.end();
  }
}

/**
 * Crea una base por worker, propiedad de kazero_owner (sin superusuario, como neondb_owner en Neon), y la
 * migra. Los roles son globales al clúster: 0001 crea kazero_app solo si no existe, así que se migra en serie
 * y la contraseña de kazero_app se asigna una sola vez y vale para todas las bases.
 */
export async function crearBases(urlAdmin: string, nombres: string[]) {
  verificarUrlPgDirecto(urlAdmin, 'KAZERO_PG_PRUEBAS_URL');
  // Sin wsproxy, el driver de Neon intentaría wss://<host>/v2 y fallaría con un error confuso.
  if (!process.env.KAZERO_PG_WSPROXY) throw new Error('Falta KAZERO_PG_WSPROXY (host:puerto del wsproxy).');
  // Literal en ALTER ROLE (no acepta parámetros): base64url solo produce [A-Za-z0-9_-].
  const pwOwner = randomBytes(24).toString('base64url');
  await ejecutar(urlAdmin, [
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kazero_owner') THEN CREATE ROLE kazero_owner; END IF; END $$`,
    `ALTER ROLE kazero_owner WITH LOGIN CREATEROLE PASSWORD '${pwOwner}'`,
    // Como neondb_owner (neon_superuser): ver la actividad de otros roles en pg_stat_activity.
    `GRANT pg_read_all_stats TO kazero_owner`,
    ...nombres.map((n) => `CREATE DATABASE "${n}" OWNER kazero_owner`),
  ]);
  const owners = nombres.map((n) => conCredenciales(urlAdmin, 'kazero_owner', pwOwner, n));
  for (const owner of owners) await migrar(owner);
  const app = new URL(await asignarPasswordApp(owners[0]!));
  return nombres.map((rama, i) => ({
    rama,
    owner: owners[i]!,
    app: conCredenciales(app.toString(), 'kazero_app', decodeURIComponent(app.password), rama),
  }));
}

/** Best effort: el contenedor de CI se destruye igual al terminar el job. */
export async function borrarBases(urlAdmin: string, nombres: string[]) {
  for (const n of nombres) {
    console.log(`[test-neon] Borrando base ${n}…`);
    try {
      await ejecutar(urlAdmin, [`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`]);
    } catch (e) {
      console.warn(`[test-neon] No se pudo borrar ${n} (${(e as { code?: string }).code ?? 'sin código'}).`);
    }
  }
}
