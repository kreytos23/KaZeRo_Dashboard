import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { rutaComprobante } from '@/domain/imagenes';
import { ErrorNegocio } from '@/server/errores';
import type { AlmacenImagenes } from '@/server/imagenes/almacen';
import { procesarImagen } from '@/server/imagenes/procesar';
import type { Comprobante } from './comprobante';

/**
 * Limpia (sin EXIF), reduce y guarda la captura en el almacén; devuelve su clave y su huella SHA-256 (R-36).
 * Se llama en la acción ANTES del servicio: si el servicio falla, el barrido recoge el blob huérfano (como con piezas).
 */
export async function subirComprobante(almacen: AlmacenImagenes, bytes: Uint8Array): Promise<Comprobante> {
  const imagen = await procesarImagen(bytes);
  const clave = randomUUID();
  try {
    await almacen.guardar(rutaComprobante(clave), imagen.grande);
  } catch (e) {
    console.error('[imagen] no se pudo guardar', e instanceof Error ? e.name : typeof e);
    throw new ErrorNegocio(
      'imagen_almacen',
      'No se pudo guardar la captura. Intenta de nuevo.',
      'comprobante',
    );
  }
  return { clave, sha256: createHash('sha256').update(bytes).digest('hex') };
}
