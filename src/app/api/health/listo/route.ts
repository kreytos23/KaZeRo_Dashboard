import { sql } from 'drizzle-orm';
import { conDb } from '@/db/client';
import { env } from '@/server/env';

export const dynamic = 'force-dynamic';

const SIN_CACHE = { 'Cache-Control': 'no-store' };

/**
 * Readiness: el entorno es válido y kazero_app puede consultar la BD. A diferencia de /api/health
 * (liveness), aquí sí se toca la BD. El error nunca se devuelve ni se loguea: puede traer la cadena de conexión.
 */
export async function GET() {
  try {
    env();
    await conDb((db) => db.execute(sql`SELECT 1 FROM sesion LIMIT 0`));
    return Response.json({ status: 'ok', db: 'ok' }, { headers: SIN_CACHE });
  } catch {
    console.error('[health/listo] falló la comprobación de entorno o de base de datos');
    return Response.json({ status: 'error' }, { status: 503, headers: SIN_CACHE });
  }
}
