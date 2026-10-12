import { conDbLectura } from '@/db/client';
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
  try {
    const resumen = await barrerImagenesHuerfanas({
      almacen: almacenImagenes(),
      clavesReferenciadas: () => conDbLectura(clavesDeImagenReferenciadas),
    });
    console.info('[barrido-imagenes]', JSON.stringify(resumen)); // solo conteos
    const idempotenciaBorradas = await limpiarIdempotenciaCron();
    console.info('[limpieza-idempotencia]', JSON.stringify({ idempotenciaBorradas })); // solo conteo
    return Response.json({ ...resumen, idempotenciaBorradas }, { headers: SIN_CACHE });
  } catch (e) {
    console.error('[barrido-imagenes] falló', e instanceof Error ? e.name : typeof e);
    return Response.json({ error: 'barrido_fallido' }, { status: 500, headers: SIN_CACHE });
  }
}
