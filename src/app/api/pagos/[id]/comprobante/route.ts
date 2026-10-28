import { conDbLectura } from '@/db/client';
import { esUuid, rutaComprobante, urlComprobante } from '@/domain/imagenes';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { almacenImagenes } from '@/server/imagenes/almacen';
import { claveDeComprobante } from '@/server/pagos/lecturas';

export const dynamic = 'force-dynamic';

const SIN_CACHE = { 'Cache-Control': 'private, no-store' };
const json = (cuerpo: object, status: number) => Response.json(cuerpo, { status, headers: SIN_CACHE });

/**
 * Captura privada de un pago (P-3). Como la foto de pieza: nunca acepta una ruta del cliente (la clave sale de la BD),
 * no se guarda en cachés compartidas ni en el navegador (`private, no-store`: puede mostrar datos bancarios) y `v`
 * solo sirve para que la URL cambie si algún día se reemplaza la captura.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sesionDeApi())) return json({ error: 'no_autenticado' }, 401);
  const { id } = await params;
  if (!esUuid(id)) return json({ error: 'no_encontrada' }, 404);
  const clave = await conDbLectura((db) => claveDeComprobante(db, id));
  if (!clave) return json({ error: 'no_encontrada' }, 404);
  if (new URL(req.url).searchParams.get('v') !== clave)
    return new Response(null, {
      status: 307,
      headers: { ...SIN_CACHE, Location: new URL(urlComprobante(id, clave), req.url).toString() },
    });
  try {
    const archivo = await almacenImagenes().leer(rutaComprobante(clave));
    if (!archivo) return json({ error: 'no_encontrada' }, 404);
    return new Response(archivo.cuerpo, {
      headers: {
        ...SIN_CACHE,
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        ...(archivo.bytes !== null ? { 'Content-Length': String(archivo.bytes) } : {}),
      },
    });
  } catch (e) {
    console.error('[imagen] no se pudo leer', e instanceof Error ? e.name : typeof e);
    return json({ error: 'no_disponible' }, 503);
  }
}
