import { Pool } from '@neondatabase/serverless';
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

export type Db = NeonDatabase<typeof schema>;

/**
 * Pool por request: en funciones serverless Neon recomienda crearlo y cerrarlo dentro del handler.
 * Node 24 trae WebSocket global, así que no hace falta configurar neonConfig.webSocketConstructor.
 */
export async function conDbUrl<T>(url: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url });
  try {
    return await fn(drizzle({ client: pool, schema }));
  } finally {
    await pool.end();
  }
}
