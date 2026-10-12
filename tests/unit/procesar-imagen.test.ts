import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { procesarImagen } from '@/server/imagenes/procesar';
import { ETIQUETA_GPS, chunksWebp, contiene, jpegDePrueba, pngDePrueba } from '../apoyo/imagenes';

const SOLO_PIXELES = ['VP8 ', 'VP8L', 'VP8X', 'ALPH'];

describe('procesarImagen (R-39)', () => {
  it('la entrada de prueba sí trae EXIF con GPS (si no, la prueba no probaría nada)', async () => {
    const jpg = await jpegDePrueba({ gps: true });
    expect(contiene(jpg, 'Exif')).toBe(true);
    expect(contiene(jpg, ETIQUETA_GPS)).toBe(true);
  });

  it('quita TODOS los metadatos: el WebP solo lleva chunks de píxeles', async () => {
    const r = await procesarImagen(await jpegDePrueba({ gps: true, p3: true }));
    for (const salida of [r.grande, r.mini]) {
      expect(chunksWebp(salida).every((c) => SOLO_PIXELES.includes(c))).toBe(true);
      const m = await sharp(salida).metadata();
      expect(m.format).toBe('webp');
      expect(m.exif).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(m.space).toBe('srgb');
    }
  });

  it('endereza según la orientación EXIF (640×480 con orientación 6 → 480×640)', async () => {
    const r = await procesarImagen(await jpegDePrueba({ orientacion: 6 }));
    expect({ ancho: r.ancho, alto: r.alto }).toEqual({ ancho: 480, alto: 640 });
  });

  it('grande: lado mayor ≤ 1600 sin agrandar; mini: 320×320', async () => {
    const r = await procesarImagen(await jpegDePrueba({ ancho: 2048, alto: 1536 }));
    expect({ ancho: r.ancho, alto: r.alto }).toEqual({ ancho: 1600, alto: 1200 });
    const mini = await sharp(r.mini).metadata();
    expect({ w: mini.width, h: mini.height }).toEqual({ w: 320, h: 320 });
    const chica = await procesarImagen(await jpegDePrueba({ ancho: 400, alto: 300 }));
    expect({ ancho: chica.ancho, alto: chica.alto }).toEqual({ ancho: 400, alto: 300 });
  });

  it('pesa mucho menos que la entrada', async () => {
    const jpg = await jpegDePrueba({ ancho: 2048, alto: 1536 });
    const r = await procesarImagen(jpg);
    expect(r.grande.length).toBeLessThan(jpg.length);
  });

  it('PNG transparente → fondo blanco, sin canal alfa', async () => {
    const r = await procesarImagen(await pngDePrueba());
    const m = await sharp(r.grande).metadata();
    expect(m.hasAlpha).toBe(false);
    const { data } = await sharp(r.grande).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255]);
  });

  it('rechaza con error en el campo `imagen`: formato, tamaño mínimo y bytes corruptos', async () => {
    await expect(procesarImagen(new TextEncoder().encode('GIF89a......'))).rejects.toMatchObject({
      campo: 'imagen',
      message: 'El archivo no es una foto JPG, PNG o WebP.',
    });
    await expect(procesarImagen(await jpegDePrueba({ ancho: 150, alto: 150 }))).rejects.toMatchObject({
      campo: 'imagen',
      message: 'La foto es muy pequeña (mínimo 200 px por lado).',
    });
    const truncado = (await jpegDePrueba()).subarray(0, 200);
    await expect(procesarImagen(truncado)).rejects.toMatchObject({
      campo: 'imagen',
      message: 'No se pudo leer la foto. Intenta con otra.',
    });
  });
});

describe('procesarImagen: entradas hostiles y espacios de color (R-39)', () => {
  const rechazo = (mensaje: string) => ({ campo: 'imagen', message: mensaje });

  it('rechaza un WebP animado', async () => {
    const ancho = 300;
    const alto = 300;
    const cuadros = Buffer.alloc(ancho * alto * 3 * 2);
    cuadros.fill(40, 0, cuadros.length / 2);
    cuadros.fill(200, cuadros.length / 2);
    const animado = await sharp(cuadros, {
      raw: { width: ancho, height: alto * 2, channels: 3, pageHeight: alto },
    })
      .webp({ delay: [100, 100], loop: 0 })
      .toBuffer();
    expect((await sharp(animado, { pages: -1 }).metadata()).pages).toBe(2);
    await expect(procesarImagen(new Uint8Array(animado))).rejects.toMatchObject(
      rechazo('Las imágenes animadas no se aceptan.'),
    );
  });

  it('un GIF animado se rechaza por formato (no es JPG, PNG o WebP)', async () => {
    const ancho = 300;
    const alto = 300;
    const cuadros = Buffer.alloc(ancho * alto * 3 * 2, 90);
    const gif = await sharp(cuadros, {
      raw: { width: ancho, height: alto * 2, channels: 3, pageHeight: alto },
    })
      .gif({ delay: [100, 100], loop: 0 })
      .toBuffer();
    await expect(procesarImagen(new Uint8Array(gif))).rejects.toMatchObject(
      rechazo('El archivo no es una foto JPG, PNG o WebP.'),
    );
  });

  it('bomba de píxeles: PNG de 6000×6000 de un solo color (pesa poco) → mensaje de megapíxeles', async () => {
    const bomba = await sharp({
      create: { width: 6000, height: 6000, channels: 3, background: '#808080' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomba.length).toBeLessThan(3 * 1024 * 1024);
    await expect(procesarImagen(new Uint8Array(bomba))).rejects.toMatchObject(
      rechazo('La foto es demasiado grande (máximo 30 megapíxeles).'),
    );
  });

  it('JPEG CMYK → WebP sRGB de 8 bits', async () => {
    const cmyk = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#2060c0' } })
      .toColourspace('cmyk')
      .jpeg()
      .toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe('cmyk');
    const r = await procesarImagen(new Uint8Array(cmyk));
    const m = await sharp(r.grande).metadata();
    expect({ formato: m.format, espacio: m.space, profundidad: m.depth }).toEqual({
      formato: 'webp',
      espacio: 'srgb',
      profundidad: 'uchar',
    });
  });

  it('PNG de 16 bits → WebP sRGB de 8 bits', async () => {
    const png16 = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#336699' } })
      .toColourspace('rgb16')
      .png()
      .toBuffer();
    expect((await sharp(png16).metadata()).depth).toBe('ushort');
    const r = await procesarImagen(new Uint8Array(png16));
    const m = await sharp(r.grande).metadata();
    expect({ espacio: m.space, profundidad: m.depth }).toEqual({ espacio: 'srgb', profundidad: 'uchar' });
  });

  it('perfil Display P3: el color se convierte a sRGB (no solo se descarta el perfil)', async () => {
    // Imagen con dos zonas (no plana). Naranja P3 (200,100,50): al pasar a sRGB el valor numérico
    // cambia a ~(188,106,63); si solo se quitara el perfil, saldría igual que entró.
    const ancho = 300;
    const crudo = Buffer.alloc(ancho * ancho * 3);
    for (let y = 0; y < ancho; y++)
      for (let x = 0; x < ancho; x++)
        crudo.set(x < 150 ? [200, 100, 50] : [30, 60, 160], (y * ancho + x) * 3);
    const p3 = await sharp(crudo, { raw: { width: ancho, height: ancho, channels: 3 } })
      .withIccProfile('p3')
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
      .toBuffer();
    expect((await sharp(p3).metadata()).icc).toBeDefined();
    const r = await procesarImagen(new Uint8Array(p3));
    const { data, info } = await sharp(r.grande).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [
      ...data.subarray((y * info.width + x) * info.channels).subarray(0, 3),
    ];
    const cerca = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
    expect(cerca(pixel(40, 150), [188, 106, 63], 5)).toBe(true);
    expect(cerca(pixel(40, 150), [200, 100, 50], 6)).toBe(false);
  });
});
