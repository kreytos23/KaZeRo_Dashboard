import { conDbLectura } from '@/db/client';
import { esUuid, rutaComprobante, urlComprobante } from '@/domain/imagenes';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { noAutenticado, respuestaImagenPrivada } from '@/server/imagenes/respuesta';
import { claveDeComprobante } from '@/server/pagos/lecturas';

export const dynamic = 'force-dynamic';

/**
 * Captura privada de un pago (P-3). Como la foto de pieza, pero no se guarda en cachés compartidas ni en el navegador
 * (`private, no-store`: puede mostrar datos bancarios); `v` solo sirve para que la URL cambie si algún día se reemplaza
 * la captura.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sesionDeApi())) return noAutenticado();
  const { id } = await params;
  return respuestaImagenPrivada(req, {
    valida: esUuid(id),
    clave: () => conDbLectura((db) => claveDeComprobante(db, id)),
    url: (clave) => urlComprobante(id, clave),
    ruta: rutaComprobante,
    cabeceras: () => ({ 'Cache-Control': 'private, no-store' }),
  });
}
