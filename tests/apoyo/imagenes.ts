import sharp from 'sharp';

/** JPEG sintético (nunca una foto real: el repo es público). GPS y orientación opcionales. */
export async function jpegDePrueba(
  o: { ancho?: number; alto?: number; gps?: boolean; orientacion?: number; p3?: boolean } = {},
): Promise<Uint8Array> {
  let img = sharp({
    create: { width: o.ancho ?? 640, height: o.alto ?? 480, channels: 3, background: '#c81e1e' },
  });
  if (o.orientacion) img = img.withMetadata({ orientation: o.orientacion });
  if (o.gps) img = img.withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '19/1 25/1 0/1' } });
  if (o.p3) img = img.withIccProfile('p3');
  return new Uint8Array(await img.jpeg({ quality: 90 }).toBuffer());
}

export async function pngDePrueba(o: { ancho?: number; alto?: number } = {}): Promise<Uint8Array> {
  const img = sharp({
    create: {
      width: o.ancho ?? 300,
      height: o.alto ?? 300,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  return new Uint8Array(await img.png().toBuffer());
}

/**
 * Nombres de los chunks RIFF de un WebP ("VP8 ", "VP8L", "VP8X", "ALPH", "EXIF", "ICCP", "XMP "…).
 * Se recorre la estructura (no se busca texto suelto, que podría aparecer por azar en los datos comprimidos).
 */
export function chunksWebp(bytes: Uint8Array): string[] {
  const ascii = (i: number) => String.fromCharCode(...bytes.subarray(i, i + 4));
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WEBP') throw new Error('No es WebP');
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nombres: string[] = [];
  for (let i = 12; i + 8 <= bytes.length;) {
    const largo = vista.getUint32(i + 4, true);
    nombres.push(ascii(i));
    i += 8 + largo + (largo % 2);
  }
  return nombres;
}

/** Etiqueta EXIF GPSInfo (0x8825) en little-endian, como la escribe libexif. */
export const ETIQUETA_GPS = Uint8Array.of(0x25, 0x88);
export const contiene = (bytes: Uint8Array, aguja: Uint8Array | string) =>
  Buffer.from(bytes).includes(typeof aguja === 'string' ? Buffer.from(aguja) : Buffer.from(aguja));
