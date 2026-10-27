import { sql } from 'drizzle-orm';
import { conDb } from '@/db/client';
import type { Db } from '@/db/pool';

/** Borra de acceso_log lo de más de 180 días (la función SQL es la única con permiso de borrado). */
export async function rotarAccesoLog(db: Db): Promise<number> {
  const r = await db.execute(sql`SELECT kz_rotar_acceso_log() AS n`);
  return Number((r.rows[0] as { n: number }).n);
}

export const rotarAccesoLogCron = (): Promise<number> => conDb(rotarAccesoLog);
