import { Pool } from '@neondatabase/serverless';
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import { configurarProxyLocal } from './proxy-local';
import { etiquetaErrorBd } from './reintento';
import * as schema from './schema';

configurarProxyLocal();

export type Db = NeonDatabase<typeof schema>;

/** La conexión directa o una transacción en curso: los servicios aceptan ambas. */
export type Ejecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Pool por request: en funciones serverless Neon recomienda crearlo y cerrarlo dentro del handler.
 * Node 24 trae WebSocket global, así que no hace falta configurar neonConfig.webSocketConstructor.
 *
 * No se comparte un pool por request con React `cache()`: no hay un gancho fiable de "fin de request"
 * para cerrarlo (sin cerrar, la función queda con WebSockets abiertos) y un pool roto arrastraría a todas
 * las lecturas de la página. Cada `conDb` abre y cierra el suyo; el costo es una conexión extra por lectura.
 */
export async function conDbUrl<T>(url: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url });
  // Un cliente inactivo que pierde la conexión emite 'error' en el pool; sin oyente, Node tumba el proceso.
  // Solo se loguea el código: el mensaje puede traer la cadena de conexión.
  pool.on('error', (e: unknown) => console.error('[bd] error en una conexión inactiva:', etiquetaErrorBd(e)));
  try {
    return await fn(drizzle({ client: pool, schema }));
  } finally {
    await pool.end();
  }
}
