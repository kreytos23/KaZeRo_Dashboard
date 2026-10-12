import {
  BYTES_OBJETIVO_SUBIDA,
  CALIDADES_SUBIDA,
  LADO_MAXIMO_SUBIDA,
  dimensionesAjustadas,
} from '@/domain/imagenes';

export const MENSAJE_PREPARAR =
  'No se pudo leer la foto. Usa JPG, PNG o WebP (en iPhone: Ajustes › Cámara › Formatos › Más compatible).';

/**
 * Reduce y re-codifica en el navegador (D4): lado mayor ≤ 2048 px, JPEG (el canvas no copia EXIF ni GPS).
 * El servidor vuelve a procesar todo; esto solo hace que una foto de celular quepa en la Server Action.
 */
export async function prepararFoto(archivo: File): Promise<File> {
  let mapa: ImageBitmap;
  try {
    mapa = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(MENSAJE_PREPARAR);
  }
  try {
    const { ancho, alto } = dimensionesAjustadas(mapa.width, mapa.height, LADO_MAXIMO_SUBIDA);
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error(MENSAJE_PREPARAR);
    ctx.fillStyle = '#ffffff'; // JPEG no tiene transparencia: fondo blanco, igual que el servidor
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(mapa, 0, 0, ancho, alto);
    let ultimo: Blob | null = null;
    for (const calidad of CALIDADES_SUBIDA) {
      ultimo = await new Promise<Blob | null>((r) => lienzo.toBlob(r, 'image/jpeg', calidad));
      if (ultimo && ultimo.size <= BYTES_OBJETIVO_SUBIDA) break;
    }
    if (!ultimo) throw new Error(MENSAJE_PREPARAR);
    return new File([ultimo], 'foto.jpg', { type: 'image/jpeg' });
  } finally {
    mapa.close();
  }
}
