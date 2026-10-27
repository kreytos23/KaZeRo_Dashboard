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

/** Una tarea independiente: si falla, se registra solo el tipo de error y devuelve null (no impide las demás). */
async function tarea<T>(nombre: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const r = await fn();
    console.info(`[${nombre}]`, JSON.stringify(r)); // solo conteos
    return r;
  } catch (e) {
    console.error(`[${nombre}] falló`, e instanceof Error ? e.name : typeof e);
    return null;
  }
}

/** Llamada SOLO por Vercel Cron (vercel.json). Sin sesión: la autoriza únicamente CRON_SECRET. */
export async function GET(req: Request) {
  if (!autorizarCron(req))
    return Response.json({ error: 'no_autenticado' }, { status: 401, headers: SIN_CACHE });
  const resumen = await tarea('barrido-imagenes', () =>
    barrerImagenesHuerfanas({
      almacen: almacenImagenes(),
      clavesReferenciadas: () => conDbLectura(clavesDeImagenReferenciadas),
    }),
  );
  const idempotenciaBorradas = await tarea('limpieza-idempotencia', async () => ({
    idempotenciaBorradas: await limpiarIdempotenciaCron(),
  }));
  const accesoLogBorradas = await tarea('rotacion-acceso-log', async () => ({
    accesoLogBorradas: await rotarAccesoLogCron(),
  }));
  if (!resumen && !idempotenciaBorradas && !accesoLogBorradas)
    return Response.json({ error: 'barrido_fallido' }, { status: 500, headers: SIN_CACHE });
  return Response.json(
    {
      ...(resumen ?? { barrido: 'fallido' }),
      idempotenciaBorradas: null,
      accesoLogBorradas: null,
      ...idempotenciaBorradas,
      ...accesoLogBorradas,
    },
    {
      status: resumen && idempotenciaBorradas && accesoLogBorradas ? 200 : 500,
      headers: SIN_CACHE,
    },
  );
}
