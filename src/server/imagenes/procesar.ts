import 'server-only';
import sharp from 'sharp';
import {
  LADO_GRANDE,
  LADO_MINI,
  LIMITE_PIXELES,
  MENSAJE_FOTO_ILEGIBLE,
  rechazoPorMetadatos,
  validarSubida,
} from '@/domain/imagenes';
import { ErrorNegocio } from '@/server/errores';

// Funciones con concurrencia (Fluid): sin caché de operaciones de libvips entre peticiones.
sharp.cache(false);

export interface ImagenProcesada {
  grande: Uint8Array;
  mini: Uint8Array;
  ancho: number;
  alto: number;
}

const error = (mensaje: string) => new ErrorNegocio('imagen', mensaje, 'imagen');

/**
 * Fuente de verdad de la limpieza (D3). Por defecto sharp convierte a sRGB y NO copia metadatos
 * (EXIF, GPS, XMP, IPTC, ICC): nunca uses keepMetadata/withMetadata/keepIccProfile aquí.
 */
export async function procesarImagen(bytes: Uint8Array): Promise<ImagenProcesada> {
  const v = validarSubida(bytes);
  if (!v.ok) throw error(v.error);
  const entrada = { limitInputPixels: LIMITE_PIXELES, autoOrient: true } as const;
  try {
    const m = await sharp(bytes, { limitInputPixels: LIMITE_PIXELES }).metadata();
    const rechazo = rechazoPorMetadatos({ ancho: m.width, alto: m.height, paginas: m.pages });
    if (rechazo) throw error(rechazo);
    const base = sharp(bytes, entrada).flatten({ background: '#ffffff' }).timeout({ seconds: 15 });
    const [grande, mini] = await Promise.all([
      base
        .clone()
        .resize({ width: LADO_GRANDE, height: LADO_GRANDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true }),
      base
        .clone()
        .resize({ width: LADO_MINI, height: LADO_MINI, fit: 'cover', position: 'attention' })
        .webp({ quality: 70, effort: 4 })
        .toBuffer(),
    ]);
    return {
      grande: new Uint8Array(grande.data),
      mini: new Uint8Array(mini),
      ancho: grande.info.width,
      alto: grande.info.height,
    };
  } catch (e) {
    if (e instanceof ErrorNegocio) throw e;
    // Solo el nombre: el mensaje de libvips puede incluir detalles del archivo.
    console.error('[imagen] no se pudo procesar', e instanceof Error ? e.name : typeof e);
    throw error(MENSAJE_FOTO_ILEGIBLE);
  }
}
