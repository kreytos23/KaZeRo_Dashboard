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
