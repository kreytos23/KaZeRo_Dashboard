import { conDbLectura } from '@/db/client';
import { esUuid, esVariante, rutaImagen, urlImagenPieza } from '@/domain/imagenes';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { noAutenticado, respuestaImagenPrivada } from '@/server/imagenes/respuesta';
import { claveImagenDePieza } from '@/server/piezas/imagen';

export const dynamic = 'force-dynamic';

/**
 * Foto privada (D7). La clave vigente sale de v_pieza y `v` hace que la URL cambie con cada foto. La caché del
 * navegador es privada y de un día, sin `immutable` (equipo compartido tras cerrar sesión), y no hay atajo 304:
 * siempre se confirma contra la BD y el almacén antes de responder.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sesionDeApi())) return noAutenticado();
  const { id } = await params;
  const t = new URL(req.url).searchParams.get('t') ?? 'grande';
  const v = esVariante(t) ? t : 'grande'; // con una variante inventada no se usa: `valida` es false
  return respuestaImagenPrivada(req, {
    valida: esUuid(id) && esVariante(t),
    clave: () => conDbLectura((db) => claveImagenDePieza(db, id)),
    url: (clave) => urlImagenPieza(id, clave, v),
    ruta: (clave) => rutaImagen(id, clave, v),
    cabeceras: (clave) => ({ 'Cache-Control': 'private, max-age=86400', ETag: `"${clave}-${v}"` }),
  });
}
