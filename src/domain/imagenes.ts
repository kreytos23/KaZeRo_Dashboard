/** Foto de pieza (R-38, R-39). Puro: lo usan el servidor, el navegador y las pruebas. */

export type FormatoImagen = 'jpeg' | 'png' | 'webp';
export type Variante = 'grande' | 'mini';

export const MAX_BYTES_SUBIDA = 3 * 1024 * 1024;
export const LIMITE_PIXELES = 30_000_000;
export const LADO_MINIMO = 200;
export const LADO_GRANDE = 1600;
export const LADO_MINI = 320;
// Navegador: reducir antes de subir para caber en el límite de la Server Action (D4).
export const LADO_MAXIMO_SUBIDA = 2048;
export const BYTES_OBJETIVO_SUBIDA = 2_500_000;
export const CALIDADES_SUBIDA = [0.9, 0.8, 0.7] as const;

export const MENSAJE_FOTO_ILEGIBLE = 'No se pudo leer la foto. Intenta con otra.';

const VARIANTES: readonly Variante[] = ['grande', 'mini'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUTA =
  /^piezas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(grande|mini)\.webp$/;
// Marcas ISO-BMFF (ftyp) de HEIF/HEIC; 'avif'/'avis' son AVIF.
const MARCAS_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const MARCAS_AVIF = new Set(['avif', 'avis']);

const ascii = (b: Uint8Array, desde: number, largo: number) =>
  b.length >= desde + largo ? String.fromCharCode(...b.subarray(desde, desde + largo)) : '';
const empieza = (b: Uint8Array, firma: readonly number[]) =>
  b.length >= firma.length && firma.every((x, i) => b[i] === x);

/** Formato por *magic bytes*. El MIME y el nombre del cliente nunca se usan. */
export function detectarFormato(b: Uint8Array): FormatoImagen | 'heic' | 'avif' | 'gif' | null {
  if (empieza(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 4, 4) === 'ftyp') {
    const marca = ascii(b, 8, 4);
    if (MARCAS_AVIF.has(marca)) return 'avif';
    if (MARCAS_HEIC.has(marca)) return 'heic';
  }
  return null;
}

export function validarSubida(
  b: Uint8Array,
): { ok: true; formato: FormatoImagen } | { ok: false; error: string } {
  if (b.length === 0) return { ok: false, error: 'Elige una foto.' };
  if (b.length > MAX_BYTES_SUBIDA) return { ok: false, error: 'La foto pesa más de 3 MB.' };
  const f = detectarFormato(b);
  if (f === 'heic' || f === 'avif')
    return { ok: false, error: 'Ese formato (HEIC/AVIF) no se puede procesar. Usa JPG, PNG o WebP.' };
  if (f === 'jpeg' || f === 'png' || f === 'webp') return { ok: true, formato: f };
  return { ok: false, error: 'El archivo no es una foto JPG, PNG o WebP.' };
}

/** Con los metadatos (sin decodificar píxeles): animadas, diminutas y bombas de descompresión. */
export function rechazoPorMetadatos(m: { ancho?: number; alto?: number; paginas?: number }): string | null {
  if (!m.ancho || !m.alto) return MENSAJE_FOTO_ILEGIBLE;
  if ((m.paginas ?? 1) > 1) return 'Las imágenes animadas no se aceptan.';
  if (m.ancho * m.alto > LIMITE_PIXELES) return 'La foto es demasiado grande (máximo 30 megapíxeles).';
  if (Math.min(m.ancho, m.alto) < LADO_MINIMO) return 'La foto es muy pequeña (mínimo 200 px por lado).';
  return null;
}

/** Lado mayor ≤ max conservando la proporción. Nunca agranda. */
export function dimensionesAjustadas(ancho: number, alto: number, max: number) {
  const escala = Math.min(1, max / Math.max(ancho, alto));
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  };
}

export const esUuid = (v: string) => UUID.test(v);
export const esVariante = (v: string): v is Variante => (VARIANTES as readonly string[]).includes(v);
export const esRutaImagen = (ruta: string) => RUTA.test(ruta);

/** Ruta en el almacén. Se construye siempre desde la BD (pieza y clave), nunca desde el cliente. */
export function rutaImagen(piezaId: string, clave: string, variante: Variante): string {
  if (!esUuid(piezaId) || !esUuid(clave) || !esVariante(variante))
    throw new RangeError('Ruta de imagen inválida');
  return `piezas/${piezaId}/${clave}-${variante}.webp`;
}

/** URL servida por la app. `v` = clave: cambia con cada foto, así la respuesta puede ser `immutable`. */
export function urlImagenPieza(piezaId: string, clave: string, variante: Variante): string {
  return `/api/piezas/${piezaId}/imagen?v=${clave}&t=${variante}`;
}
