import 'server-only';
import sharp from 'sharp';
import {
  LADO_GRANDE,
  LADO_MINI,
  LIMITE_PIXELES,
  MENSAJE_FOTO_GRANDE,
  MENSAJE_FOTO_ILEGIBLE,
  rechazoPorMetadatos,
  validarSubida,
} from '@/domain/imagenes';
import { ErrorNegocio } from '@/server/errores';

// Funciones con concurrencia (Fluid): sin caché de operaciones de libvips entre peticiones y con
// pocos hilos por imagen, para acotar la memoria y la CPU cuando llegan varias subidas a la vez.
sharp.cache(false);
sharp.concurrency(2);

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
  const opciones = { limitInputPixels: LIMITE_PIXELES } as const;
  try {
    const m = await sharp(bytes, opciones).timeout({ seconds: 15 }).metadata();
    const rechazo = rechazoPorMetadatos({ ancho: m.width, alto: m.height, paginas: m.pages });
    if (rechazo) throw error(rechazo);
    // Se decodifica una sola vez. 'rgb16' como espacio de trabajo hace que sharp APLIQUE el perfil ICC
    // incrustado (P3, Adobe RGB, CMYK…) al pasar a sRGB; sin esto solo lo descartaría y los colores
    // saldrían alterados.
    const grande = await sharp(bytes, { ...opciones, autoOrient: true })
      .timeout({ seconds: 15 })
      .pipelineColourspace('rgb16')
      .flatten({ background: '#ffffff' })
      .resize({ width: LADO_GRANDE, height: LADO_GRANDE, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .webp({ quality: 80, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    // La miniatura sale de la grande (≤ 1600 px, ya limpia y en sRGB), en secuencia: menos memoria.
    // Es cuadrada fija: una foto de 200–319 px se agranda (aceptable para una miniatura).
    const mini = await sharp(grande.data)
      .resize({ width: LADO_MINI, height: LADO_MINI, fit: 'cover', position: 'attention' })
      .webp({ quality: 70, effort: 4 })
      .toBuffer();
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
    // libvips/sharp avisa de la bomba de píxeles con "exceeds pixel limit".
    if (e instanceof Error && /pixel limit/i.test(e.message)) throw error(MENSAJE_FOTO_GRANDE);
    throw error(MENSAJE_FOTO_ILEGIBLE);
  }
}
