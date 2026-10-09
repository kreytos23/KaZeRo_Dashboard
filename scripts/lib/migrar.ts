import { randomBytes } from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';

export async function migrar(urlOwner: string): Promise<void> {
  const pool = new Pool({ connectionString: urlOwner });
  pool.on('error', () => {}); // evita que un cierre del servidor al borrar la rama tumbe el proceso
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
