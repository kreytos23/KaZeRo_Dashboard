import { conDbLectura } from '@/db/client';
import { rotarAccesoLogCron } from '@/server/auth/rotacion';
import { limpiarIdempotenciaCron } from '@/server/idempotencia';
import { almacenImagenes } from '@/server/imagenes/almacen';
import { barrerImagenesHuerfanas } from '@/server/imagenes/barrido';
import { clavesDeImagenReferenciadas } from '@/server/piezas/imagen';
import { autorizarCron } from '@/server/seguridad/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

/** Llamada SOLO por Vercel Cron (vercel.json). Sin sesión: la autoriza únicamente CRON_SECRET. */
export async function GET(req: Request) {
  if (!autorizarCron(req))
    return Response.json({ error: 'no_autenticado' }, { status: 401, headers: SIN_CACHE });
  // Tres tareas independientes: que una falle no impide las demás.
  let resumen: Awaited<ReturnType<typeof barrerImagenesHuerfanas>> | null = null;
  let idempotenciaBorradas: number | null = null;
  try {
    resumen = await barrerImagenesHuerfanas({
      almacen: almacenImagenes(),
      clavesReferenciadas: () => conDbLectura(clavesDeImagenReferenciadas),
    });
    console.info('[barrido-imagenes]', JSON.stringify(resumen)); // solo conteos
  } catch (e) {
    console.error('[barrido-imagenes] falló', e instanceof Error ? e.name : typeof e);
  }
  try {
    idempotenciaBorradas = await limpiarIdempotenciaCron();
    console.info('[limpieza-idempotencia]', JSON.stringify({ idempotenciaBorradas })); // solo conteo
  } catch (e) {
    console.error('[limpieza-idempotencia] falló', e instanceof Error ? e.name : typeof e);
  }
  let accesoLogBorradas: number | null = null;
  try {
    accesoLogBorradas = await rotarAccesoLogCron();
    console.info('[rotacion-acceso-log]', JSON.stringify({ accesoLogBorradas })); // solo conteo
  } catch (e) {
    console.error('[rotacion-acceso-log] falló', e instanceof Error ? e.name : typeof e);
  }
  if (!resumen && idempotenciaBorradas === null && accesoLogBorradas === null)
    return Response.json({ error: 'barrido_fallido' }, { status: 500, headers: SIN_CACHE });
  return Response.json(
    { ...(resumen ?? { barrido: 'fallido' }), idempotenciaBorradas, accesoLogBorradas },
    {
      status: resumen && idempotenciaBorradas !== null && accesoLogBorradas !== null ? 200 : 500,
      headers: SIN_CACHE,
    },
  );
}
