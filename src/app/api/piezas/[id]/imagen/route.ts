import { conDbLectura } from '@/db/client';
import { esUuid, esVariante, rutaImagen, urlImagenPieza } from '@/domain/imagenes';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { almacenImagenes } from '@/server/imagenes/almacen';
import { claveImagenDePieza } from '@/server/piezas/imagen';

export const dynamic = 'force-dynamic';

const SIN_CACHE = { 'Cache-Control': 'private, no-store' };
const json = (cuerpo: object, status: number) => Response.json(cuerpo, { status, headers: SIN_CACHE });
const CACHEABLE = {
  'Cache-Control': 'private, max-age=86400',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/**
 * Foto privada (D7). Nunca acepta una ruta del cliente: la clave vigente sale de v_pieza. `v` hace que la URL cambie con cada
 * foto. La caché del navegador es privada y de un día, sin `immutable` (equipo compartido tras cerrar sesión), y no
 * hay atajo 304: siempre se confirma contra la BD y el almacén antes de responder.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sesionDeApi())) return json({ error: 'no_autenticado' }, 401);
  const { id } = await params;
  const url = new URL(req.url);
  const t = url.searchParams.get('t') ?? 'grande';
  if (!esUuid(id) || !esVariante(t)) return json({ error: 'no_encontrada' }, 404);
  const clave = await conDbLectura((db) => claveImagenDePieza(db, id));
  if (!clave) return json({ error: 'no_encontrada' }, 404);
  if (url.searchParams.get('v') !== clave)
    return new Response(null, {
      status: 307,
      headers: { ...SIN_CACHE, Location: new URL(urlImagenPieza(id, clave, t), req.url).toString() },
    });
  const etiqueta = `"${clave}-${t}"`;
  try {
    const archivo = await almacenImagenes().leer(rutaImagen(id, clave, t));
    if (!archivo) return json({ error: 'no_encontrada' }, 404);
    return new Response(archivo.cuerpo, {
      headers: {
        ...CACHEABLE,
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline',
        ETag: etiqueta,
        ...(archivo.bytes !== null ? { 'Content-Length': String(archivo.bytes) } : {}),
      },
    });
  } catch (e) {
    console.error('[imagen] no se pudo leer', e instanceof Error ? e.name : typeof e);
    return json({ error: 'no_disponible' }, 503);
  }
}
