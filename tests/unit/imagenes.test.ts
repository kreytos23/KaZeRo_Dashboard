import { describe, expect, it } from 'vitest';
import {
  LADO_MINIMO,
  LIMITE_PIXELES,
  MAX_BYTES_SUBIDA,
  detectarFormato,
  dimensionesAjustadas,
  esRutaImagen,
  esVariante,
  rechazoPorMetadatos,
  rutaImagen,
  urlImagenPieza,
  validarSubida,
} from '@/domain/imagenes';

const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(32).fill(0)]);
const ftyp = (marca: string) =>
  Uint8Array.from([
    0,
    0,
    0,
    24,
    ...Buffer.from('ftyp'),
    ...Buffer.from(marca),
    0,
    0,
    0,
    0,
    ...new Array(16).fill(0),
  ]);
const riff = (tipo: string) =>
  Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from(tipo), ...new Array(20).fill(0)]);

const PIEZA = '0b6f2c1e-3f4a-4c5d-8e9f-a0b1c2d3e4f5';
const CLAVE = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

describe('detectarFormato (magic bytes, nunca el MIME)', () => {
  it.each([
    ['jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ['webp', riff('WEBP')],
    ['heic', ftyp('heic')],
    ['heic', ftyp('mif1')],
    ['avif', ftyp('avif')],
    ['gif', Uint8Array.from([...Buffer.from('GIF89a'), ...new Array(20).fill(0)])],
  ] as const)('%s', (formato, b) => {
    expect(detectarFormato(b)).toBe(formato);
  });
  it('RIFF que no es WebP (p. ej. WAV), texto o SVG → null', () => {
    expect(detectarFormato(riff('WAVE'))).toBeNull();
    expect(detectarFormato(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectarFormato(new Uint8Array(3))).toBeNull();
  });
});

describe('validarSubida (R-39)', () => {
  it('vacío → pide elegir una foto', () => {
    expect(validarSubida(new Uint8Array(0))).toEqual({ ok: false, error: 'Elige una foto.' });
  });
  it('más de 3 MB → rechaza antes de mirar el formato', () => {
    const grande = new Uint8Array(MAX_BYTES_SUBIDA + 1);
    grande.set([0xff, 0xd8, 0xff]);
    expect(validarSubida(grande)).toEqual({ ok: false, error: 'La foto pesa más de 3 MB.' });
  });
  it('HEIC/AVIF con mensaje propio; GIF u otro → no es una foto aceptada', () => {
    expect(validarSubida(ftyp('heic'))).toEqual({
      ok: false,
      error: 'Ese formato (HEIC/AVIF) no se puede procesar. Usa JPG, PNG o WebP.',
    });
    expect(validarSubida(riff('WAVE'))).toEqual({
      ok: false,
      error: 'El archivo no es una foto JPG, PNG o WebP.',
    });
  });
  it('JPEG válido → ok con su formato', () => {
    expect(validarSubida(bytes(0xff, 0xd8, 0xff, 0xdb))).toEqual({ ok: true, formato: 'jpeg' });
  });
});

describe('rechazoPorMetadatos (animadas y bombas de descompresión)', () => {
  it('acepta una foto normal', () => {
    expect(rechazoPorMetadatos({ ancho: 2048, alto: 1536, paginas: 1 })).toBeNull();
    expect(rechazoPorMetadatos({ ancho: 2048, alto: 1536 })).toBeNull();
  });
  it('rechaza animadas, diminutas, gigantes y sin dimensiones', () => {
    expect(rechazoPorMetadatos({ ancho: 500, alto: 500, paginas: 2 })).toBe(
      'Las imágenes animadas no se aceptan.',
    );
    expect(rechazoPorMetadatos({ ancho: LADO_MINIMO - 1, alto: 900 })).toBe(
      'La foto es muy pequeña (mínimo 200 px por lado).',
    );
    expect(rechazoPorMetadatos({ ancho: 10_000, alto: LIMITE_PIXELES / 10_000 + 1 })).toBe(
      'La foto es demasiado grande (máximo 30 megapíxeles).',
    );
    expect(rechazoPorMetadatos({})).toBe('No se pudo leer la foto. Intenta con otra.');
  });
});

describe('dimensionesAjustadas', () => {
  it('reduce el lado mayor al máximo conservando la proporción (redondeo, mínimo 1)', () => {
    expect(dimensionesAjustadas(4032, 3024, 2048)).toEqual({ ancho: 2048, alto: 1536 });
    expect(dimensionesAjustadas(3024, 4032, 2048)).toEqual({ ancho: 1536, alto: 2048 });
    expect(dimensionesAjustadas(10_000, 3, 2048)).toEqual({ ancho: 2048, alto: 1 });
  });
  it('nunca agranda', () => {
    expect(dimensionesAjustadas(800, 600, 2048)).toEqual({ ancho: 800, alto: 600 });
  });
});

describe('rutas y URLs (nunca vienen del cliente)', () => {
  it('ruta de Blob determinista e inmutable por clave', () => {
    expect(rutaImagen(PIEZA, CLAVE, 'mini')).toBe(`piezas/${PIEZA}/${CLAVE}-mini.webp`);
    expect(esRutaImagen(rutaImagen(PIEZA, CLAVE, 'grande'))).toBe(true);
  });
  it('rechaza recorridos, mayúsculas y variantes inventadas', () => {
    expect(() => rutaImagen('../x', CLAVE, 'mini')).toThrow();
    expect(() => rutaImagen(PIEZA, CLAVE, 'original' as never)).toThrow();
    expect(esRutaImagen(`piezas/${PIEZA}/../${CLAVE}-mini.webp`)).toBe(false);
    expect(esRutaImagen(`capturas/${PIEZA}/${CLAVE}-mini.webp`)).toBe(false);
    expect(esVariante('mini')).toBe(true);
    expect(esVariante('MINI')).toBe(false);
  });
  it('URL de la app con la clave como versión (caché inmutable)', () => {
    expect(urlImagenPieza(PIEZA, CLAVE, 'mini')).toBe(`/api/piezas/${PIEZA}/imagen?v=${CLAVE}&t=mini`);
  });
});
