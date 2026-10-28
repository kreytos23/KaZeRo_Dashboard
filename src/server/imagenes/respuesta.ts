import 'server-only';
import { almacenImagenes } from '@/server/imagenes/almacen';

const SIN_CACHE = { 'Cache-Control': 'private, no-store' };
const json = (cuerpo: object, status: number) => Response.json(cuerpo, { status, headers: SIN_CACHE });

/** 401 de las rutas de imagen privada: JSON y sin caché. La ruta valida la sesión en su primera sentencia. */
export const noAutenticado = () => json({ error: 'no_autenticado' }, 401);

/**
 * Imagen privada servida por la app (foto de pieza, comprobante de pago), ya con la sesión validada. Nunca acepta una
 * ruta del cliente: la clave vigente sale de la BD. Parámetros inválidos o sin imagen → 404; `v` distinto de la clave
 * vigente → 307 a la URL vigente; el almacén caído → 503. Los errores y la redirección van sin caché; la imagen lleva
 * las cabeceras de seguridad comunes más las de `cabeceras` (caché y ETag de cada ruta).
 */
export async function respuestaImagenPrivada(
  req: Request,
  d: {
    /** Los parámetros tienen forma válida; si no, 404 sin consultar la BD. */
    valida: boolean;
    clave: () => Promise<string | null>;
    url: (clave: string) => string;
    ruta: (clave: string) => string;
    cabeceras: (clave: string) => Record<string, string>;
  },
): Promise<Response> {
  if (!d.valida) return json({ error: 'no_encontrada' }, 404);
  const clave = await d.clave();
  if (!clave) return json({ error: 'no_encontrada' }, 404);
  if (new URL(req.url).searchParams.get('v') !== clave)
    return new Response(null, {
      status: 307,
      headers: { ...SIN_CACHE, Location: new URL(d.url(clave), req.url).toString() },
    });
  try {
    const archivo = await almacenImagenes().leer(d.ruta(clave));
    if (!archivo) return json({ error: 'no_encontrada' }, 404);
    return new Response(archivo.cuerpo, {
      headers: {
        ...d.cabeceras(clave),
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
