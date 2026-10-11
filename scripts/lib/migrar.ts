import { randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';

/**
 * Límites de la sesión de migración: si un DDL espera un lock (p. ej. una transacción larga de la app
 * en producción), falla a los 5 s en vez de quedarse esperando y bloquear a todos los que vienen detrás.
 */
const SESION_MIGRACION = ["SET lock_timeout = '5s'", "SET statement_timeout = '120s'"];

export async function migrar(urlOwner: string): Promise<void> {
  // Una sola conexión: los SET valen por sesión y así toda la migración corre en la misma.
  const pool = new Pool({ connectionString: urlOwner, max: 1 });
  pool.on('error', () => {}); // evita que un cierre del servidor al borrar la rama tumbe el proceso
  // pg encola estas sentencias en el cliente antes de entregarlo, así que corren antes que la migración.
  pool.on('connect', (cliente: PoolClient) => {
    for (const s of SESION_MIGRACION) void cliente.query(s);
  });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' });
  } finally {
    await pool.end();
  }
}

/**
 * Pone LOGIN y una contraseña nueva a kazero_app en la rama de `urlOwner`, y devuelve la URL de la app.
 * El password va como literal porque ALTER ROLE no acepta parámetros. Es seguro: base64url solo produce [A-Za-z0-9_-].
 */
export async function asignarPasswordApp(
  urlOwner: string,
  opciones: { pooled?: boolean } = {},
): Promise<string> {
  const password = randomBytes(24).toString('base64url');
  const pool = new Pool({ connectionString: urlOwner });
  pool.on('error', () => {}); // evita que un cierre del servidor al borrar la rama tumbe el proceso
  try {
    await pool.query(`ALTER ROLE kazero_app WITH LOGIN PASSWORD '${password}'`);
  } finally {
    await pool.end();
  }
  const u = new URL(urlOwner);
  u.username = 'kazero_app';
  u.password = password;
  if (opciones.pooled && !u.hostname.includes('-pooler.')) {
    u.hostname = u.hostname.replace(/^([^.]+)\./, '$1-pooler.');
  }
  return u.toString();
}
