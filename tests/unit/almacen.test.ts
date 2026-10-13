import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlmacenImagenes } from '@/server/imagenes/almacen';

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async () => ({})),
  get: vi.fn(async () => null),
  del: vi.fn(async () => undefined),
  list: vi.fn(async () => ({ blobs: [], hasMore: false })),
}));

const { put, get, del, list } = await import('@vercel/blob');
const { configuracionAlmacen } = await import('@/server/imagenes/almacen');
const { crearAlmacenBlob } = await import('@/server/imagenes/almacen-blob');
const { crearAlmacenDisco } = await import('@/server/imagenes/almacen-disco');
const { crearAlmacenMemoria } = await import('../apoyo/almacen-memoria');

const P1 = '0b6f2c1e-3f4a-4c5d-8e9f-a0b1c2d3e4f5';
const P2 = '1c7a3d2f-4a5b-4d6e-9fa0-b1c2d3e4f506';
const K1 = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const K2 = '2a3b4c5d-6e7f-4a8b-8c9d-0e1f2a3b4c5d';
const RUTA = `piezas/${P1}/${K1}-mini.webp`;
const RUTA_B = `piezas/${P1}/${K1}-grande.webp`;
const RUTA_C = `piezas/${P2}/${K2}-mini.webp`;
const leerTodo = async (s: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(s).arrayBuffer());

describe('configuracionAlmacen (D5)', () => {
  it('por defecto Blob, y exige el token (sin imprimirlo)', () => {
    expect(configuracionAlmacen({ BLOB_READ_WRITE_TOKEN: 'secreto' })).toEqual({
      tipo: 'blob',
      token: 'secreto',
    });
    expect(configuracionAlmacen({ KAZERO_ALMACEN_IMAGENES: '', BLOB_READ_WRITE_TOKEN: 'secreto' })).toEqual({
      tipo: 'blob',
      token: 'secreto',
    });
    expect(() => configuracionAlmacen({})).toThrow('Falta BLOB_READ_WRITE_TOKEN');
    expect(() => configuracionAlmacen({ BLOB_READ_WRITE_TOKEN: '' })).toThrow('Falta BLOB_READ_WRITE_TOKEN');
  });
  it('en producción solo Blob, y sin token falla cerrado', () => {
    const prod = { NODE_ENV: 'production' };
    expect(() => configuracionAlmacen(prod)).toThrow('Falta BLOB_READ_WRITE_TOKEN');
    expect(() => configuracionAlmacen({ ...prod, KAZERO_ALMACEN_IMAGENES: 'memoria' })).toThrow(
      'El almacén en memoria no se usa en producción',
    );
    expect(() =>
      configuracionAlmacen({
        ...prod,
        VERCEL: '1',
        KAZERO_ALMACEN_IMAGENES: 'disco',
        KAZERO_DIR_IMAGENES: tmpdir(),
      }),
    ).toThrow('El almacén en disco no se usa en Vercel');
  });
  it('disco exige ruta absoluta y nunca corre en Vercel', () => {
    const dir = join(tmpdir(), 'kz');
    expect(configuracionAlmacen({ KAZERO_ALMACEN_IMAGENES: 'disco', KAZERO_DIR_IMAGENES: dir })).toEqual({
      tipo: 'disco',
      dir,
    });
    expect(() =>
      configuracionAlmacen({ KAZERO_ALMACEN_IMAGENES: 'disco', KAZERO_DIR_IMAGENES: 'rel' }),
    ).toThrow('KAZERO_DIR_IMAGENES debe ser una ruta absoluta');
    expect(() => configuracionAlmacen({ KAZERO_ALMACEN_IMAGENES: 'disco' })).toThrow(
      'KAZERO_DIR_IMAGENES debe ser una ruta absoluta',
    );
    expect(() =>
      configuracionAlmacen({ KAZERO_ALMACEN_IMAGENES: 'disco', KAZERO_DIR_IMAGENES: dir, VERCEL: '1' }),
    ).toThrow('El almacén en disco no se usa en Vercel');
  });
  it('memoria solo fuera de producción y de Vercel', () => {
    expect(configuracionAlmacen({ KAZERO_ALMACEN_IMAGENES: 'memoria', NODE_ENV: 'test' })).toEqual({
      tipo: 'memoria',
    });
    expect(() => configuracionAlmacen({ KAZERO_ALMACEN_IMAGENES: 'memoria', VERCEL: '1' })).toThrow(
      'El almacén en memoria no se usa en Vercel',
    );
  });
  it('un tipo desconocido falla cerrado y el mensaje no incluye valores', () => {
    expect(() =>
      configuracionAlmacen({ KAZERO_ALMACEN_IMAGENES: 's3', BLOB_READ_WRITE_TOKEN: 'secreto' }),
    ).toThrow(/KAZERO_ALMACEN_IMAGENES debe ser "blob", "disco" o "memoria"\.$/);
  });
  it('ningún mensaje de error contiene el token', () => {
    for (const e of [
      { KAZERO_ALMACEN_IMAGENES: 'disco', KAZERO_DIR_IMAGENES: 'rel', BLOB_READ_WRITE_TOKEN: 'secreto-xyz' },
      { KAZERO_ALMACEN_IMAGENES: 'x', BLOB_READ_WRITE_TOKEN: 'secreto-xyz' },
    ]) {
      expect(() => configuracionAlmacen(e)).toThrow();
      try {
        configuracionAlmacen(e);
      } catch (err) {
        expect((err as Error).message).not.toContain('secreto-xyz');
      }
    }
  });
});

/** Contrato común: Blob (producción), disco (E2E) y memoria (integración) se comportan igual. */
function contrato(
  nombre: string,
  crear: () => AlmacenImagenes,
  hook?: { antes?: () => void; despues?: () => void },
) {
  describe(`contrato AlmacenImagenes: ${nombre}`, () => {
    let a: AlmacenImagenes;
    beforeEach(() => {
      hook?.antes?.();
      a = crear();
    });
    afterEach(() => hook?.despues?.());

    it('guarda y lee los mismos bytes con su tamaño; inexistente → null', async () => {
      expect(await a.leer(RUTA)).toBeNull();
      await a.guardar(RUTA, Uint8Array.of(7, 8, 9));
      const r = await a.leer(RUTA);
      expect(r?.bytes).toBe(3);
      expect(await leerTodo(r!.cuerpo)).toEqual(Uint8Array.of(7, 8, 9));
    });
    it('nunca sobrescribe una ruta existente (y conserva el original)', async () => {
      await a.guardar(RUTA, Uint8Array.of(1));
      await expect(a.guardar(RUTA, Uint8Array.of(2))).rejects.toThrow();
      expect(await leerTodo((await a.leer(RUTA))!.cuerpo)).toEqual(Uint8Array.of(1));
    });
    it('borra por lotes; repetidas e inexistentes no fallan; lote vacío tampoco', async () => {
      await a.guardar(RUTA, Uint8Array.of(1));
      await a.guardar(RUTA_B, Uint8Array.of(2));
      await a.guardar(RUTA_C, Uint8Array.of(3));
      await a.borrar([RUTA, RUTA, RUTA_B, `piezas/${P2}/${K1}-mini.webp`]);
      await a.borrar([]);
      expect(await a.leer(RUTA)).toBeNull();
      expect(await a.leer(RUTA_B)).toBeNull();
      expect(await a.leer(RUTA_C)).not.toBeNull();
    });
    it('una ruta inválida en un lote no borra nada', async () => {
      await a.guardar(RUTA, Uint8Array.of(1));
      await expect(a.borrar([RUTA, '../../x'])).rejects.toThrow();
      expect(await a.leer(RUTA)).not.toBeNull();
    });
    it.each([
      'capturas/x.png',
      '../../x',
      `piezas/${P1}/../${K1}-mini.webp`,
      `piezas/${P1}/${K1}-mini.webp/`,
      `/piezas/${P1}/${K1}-mini.webp`,
      `piezas\\${P1}\\${K1}-mini.webp`,
      `piezas/${P1}/${K1}-mini.webp\u0000`,
      '',
    ])('rechaza la ruta inválida %j en todas las operaciones', async (mala) => {
      await expect(a.guardar(mala, Uint8Array.of(1))).rejects.toThrow();
      await expect(a.leer(mala)).rejects.toThrow();
      await expect(a.borrar([mala])).rejects.toThrow();
    });
    it('lista por prefijo con ruta, fecha y tamaño, ordenado, y solo lo que es foto', async () => {
      await a.guardar(RUTA_C, Uint8Array.of(1, 2, 3, 4));
      await a.guardar(RUTA, Uint8Array.of(1, 2));
      await a.guardar(RUTA_B, Uint8Array.of(1));
      const todo = await a.listar('piezas/');
      expect(todo.siguiente).toBeNull();
      expect(todo.objetos.map((o) => [o.ruta, o.bytes])).toEqual([
        [RUTA_B, 1],
        [RUTA, 2],
        [RUTA_C, 4],
      ]);
      for (const o of todo.objetos) {
        expect(o.subidoEn).toBeInstanceOf(Date);
        expect(Number.isNaN(o.subidoEn.getTime())).toBe(false);
      }
      const solo1 = await a.listar(`piezas/${P1}/`);
      expect(solo1.objetos.map((o) => o.ruta)).toEqual([RUTA_B, RUTA]);
      expect((await a.listar(`piezas/${P1}/${K2}`)).objetos).toEqual([]);
      // Mismo fixture: paginar con cursor sin repetir ni omitir.
      const vistas: string[] = [];
      let cursor: string | undefined;
      let paginas = 0;
      do {
        const p: Awaited<ReturnType<AlmacenImagenes['listar']>> = await a.listar('piezas/', cursor, 2);
        expect(p.objetos.length).toBeLessThanOrEqual(2);
        vistas.push(...p.objetos.map((o) => o.ruta));
        cursor = p.siguiente ?? undefined;
        paginas++;
      } while (cursor && paginas < 10);
      expect(paginas).toBe(2);
      expect(vistas).toEqual([RUTA_B, RUTA, RUTA_C]);
    });
    it('rechaza prefijos fuera de piezas/', async () => {
      for (const p of ['', '/', 'capturas/', '../', 'piezas/../x', 'piezas\\', 'piez']) {
        await expect(a.listar(p)).rejects.toThrow();
      }
    });
  });
}

let dirContrato = '';
contrato('memoria', () => crearAlmacenMemoria());
contrato('disco', () => crearAlmacenDisco(dirContrato), {
  antes: () => {
    dirContrato = mkdtempSync(join(tmpdir(), 'kazero-contrato-'));
  },
  despues: () => rmSync(dirContrato, { recursive: true, force: true }),
});

describe('almacén en memoria', () => {
  it('usa el reloj inyectado (fechas deterministas)', async () => {
    const fechas = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z')];
    const a = crearAlmacenMemoria({ ahora: () => fechas.shift()! });
    await a.guardar(RUTA, Uint8Array.of(1));
    await a.guardar(RUTA_C, Uint8Array.of(1));
    const { objetos } = await a.listar('piezas/');
    expect(objetos.map((o) => o.subidoEn.toISOString())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    ]);
  });
  it('sembrar fija la fecha de subida y tamPagina acota las páginas', async () => {
    const a = crearAlmacenMemoria({ tamPagina: 1 });
    a.sembrar(RUTA, new Date('2020-05-05T00:00:00Z'));
    a.sembrar(RUTA_C, new Date('2021-05-05T00:00:00Z'));
    const p1 = await a.listar('piezas/');
    expect(p1.objetos).toHaveLength(1);
    expect(p1.siguiente).not.toBeNull();
    const p2 = await a.listar('piezas/', p1.siguiente!);
    expect(p2.siguiente).toBeNull();
    const fechas = [...p1.objetos, ...p2.objetos].map((o) => [o.ruta, o.subidoEn.toISOString()]);
    expect(fechas).toContainEqual([RUTA, '2020-05-05T00:00:00.000Z']);
    expect(fechas).toContainEqual([RUTA_C, '2021-05-05T00:00:00.000Z']);
    expect(() => a.sembrar('piezas/leeme.txt', new Date())).toThrow();
  });
  it('simula fallas a pedido y expone sus rutas', async () => {
    const a = crearAlmacenMemoria();
    await a.guardar(RUTA, Uint8Array.of(1));
    expect(a.rutas()).toEqual([RUTA]);
    await expect(
      crearAlmacenMemoria({ fallarAlGuardar: true }).guardar(RUTA, Uint8Array.of(1)),
    ).rejects.toThrow();
    await expect(crearAlmacenMemoria({ fallarAlBorrar: true }).borrar([RUTA])).rejects.toThrow();
    await expect(crearAlmacenMemoria({ fallarAlListar: true }).listar('piezas/')).rejects.toThrow();
  });
  it('no comparte memoria con los datos del llamador (copia al guardar)', async () => {
    const a = crearAlmacenMemoria();
    const d = Uint8Array.of(1, 2);
    await a.guardar(RUTA, d);
    d[0] = 99;
    expect(a.bytes(RUTA)).toEqual(Uint8Array.of(1, 2));
  });
});

describe('almacén en disco', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kazero-imagenes-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('escritura atómica: sin temporales tras guardar ni tras un intento duplicado', async () => {
    const a = crearAlmacenDisco(dir);
    await a.guardar(RUTA, Uint8Array.of(1));
    await expect(a.guardar(RUTA, Uint8Array.of(2))).rejects.toThrow();
    expect(readdirSync(join(dir, 'piezas', P1))).toEqual([`${K1}-mini.webp`]);
  });
  it('no escribe fuera del directorio base con rutas maliciosas', async () => {
    const base = join(dir, 'base');
    const a = crearAlmacenDisco(base);
    await expect(a.guardar(`piezas/${P1}/../../../fuera.webp`, Uint8Array.of(1))).rejects.toThrow();
    expect(existsSync(join(dir, 'fuera.webp'))).toBe(false);
    expect(existsSync(base)).toBe(false);
  });
  it('la fecha de la lista es la de escritura', async () => {
    const a = crearAlmacenDisco(dir);
    const antes = Date.now() - 5_000;
    await a.guardar(RUTA, Uint8Array.of(1));
    const [o] = (await a.listar('piezas/')).objetos;
    expect(o!.subidoEn.getTime()).toBeGreaterThanOrEqual(antes);
    expect(o!.subidoEn.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });
  it('listar sin directorio creado devuelve vacío', async () => {
    expect(await crearAlmacenDisco(join(dir, 'nuevo')).listar('piezas/')).toEqual({
      objetos: [],
      siguiente: null,
    });
  });
});

describe('crearAlmacenBlob (solo mapeo de argumentos; sin red)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sube privado, sin sufijo aleatorio, sin sobrescribir, como image/webp y con el token explícito', async () => {
    await crearAlmacenBlob('tk').guardar(RUTA, Uint8Array.of(1, 2, 3));
    expect(put).toHaveBeenCalledWith(RUTA, expect.any(Buffer), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'image/webp',
      cacheControlMaxAge: 31_536_000,
      token: 'tk',
    });
  });
  it('lee privado; inexistente → null', async () => {
    expect(await crearAlmacenBlob('tk').leer(RUTA)).toBeNull();
    expect(get).toHaveBeenCalledWith(RUTA, { access: 'private', token: 'tk' });
  });
  it('lee: devuelve el stream y el tamaño; un 304 cuenta como no leído', async () => {
    const stream = new Blob([Uint8Array.of(5)]).stream();
    vi.mocked(get).mockResolvedValueOnce({ statusCode: 200, stream, blob: { size: 1 } } as never);
    const r = await crearAlmacenBlob('tk').leer(RUTA);
    expect(r?.bytes).toBe(1);
    expect(r?.cuerpo).toBe(stream);
    vi.mocked(get).mockResolvedValueOnce({ statusCode: 304, stream: null, blob: {} } as never);
    expect(await crearAlmacenBlob('tk').leer(RUTA)).toBeNull();
  });
  it('borra por lotes con una sola llamada, sin repetidas', async () => {
    await crearAlmacenBlob('tk').borrar([RUTA, RUTA, RUTA_B]);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith([RUTA, RUTA_B], { token: 'tk' });
    await crearAlmacenBlob('tk').borrar([]);
    expect(del).toHaveBeenCalledTimes(1);
  });
  it('lista con prefijo, cursor y límite; mapea ruta, fecha y tamaño; ignora lo ajeno', async () => {
    const f = new Date('2026-02-03T04:05:06Z');
    vi.mocked(list).mockResolvedValueOnce({
      blobs: [
        { pathname: RUTA, uploadedAt: f, size: 10 },
        { pathname: 'piezas/ajeno.txt', uploadedAt: f, size: 1 },
      ],
      hasMore: true,
      cursor: 'c2',
    } as never);
    const r = await crearAlmacenBlob('tk').listar('piezas/', 'c1', 50);
    expect(list).toHaveBeenCalledWith({ prefix: 'piezas/', cursor: 'c1', limit: 50, token: 'tk' });
    expect(r).toEqual({ objetos: [{ ruta: RUTA, subidoEn: f, bytes: 10 }], siguiente: 'c2' });
    vi.mocked(list).mockResolvedValueOnce({ blobs: [], hasMore: false } as never);
    expect((await crearAlmacenBlob('tk').listar('piezas/')).siguiente).toBeNull();
  });
  it('rechaza rutas y prefijos ajenos (nunca llama al SDK)', async () => {
    const a = crearAlmacenBlob('tk');
    await expect(a.guardar('capturas/x.png', Uint8Array.of(1))).rejects.toThrow();
    await expect(a.borrar(['../../x'])).rejects.toThrow();
    await expect(a.leer('../x')).rejects.toThrow();
    await expect(a.listar('capturas/')).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
