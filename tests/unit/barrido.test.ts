import { describe, expect, it } from 'vitest';
import { rutaImagen } from '@/domain/imagenes';
import type { AlmacenImagenes } from '@/server/imagenes/almacen';
import { barrerImagenesHuerfanas } from '@/server/imagenes/barrido';
import { crearAlmacenMemoria } from '../apoyo/almacen-memoria';

const AHORA = new Date('2026-10-13T10:00:00Z');
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PIEZA = uuid(1);
type Mem = ReturnType<typeof crearAlmacenMemoria>;
const sembrarFoto = (a: Mem, clave: string, fecha: Date) => {
  a.sembrar(rutaImagen(PIEZA, clave, 'grande'), fecha);
  a.sembrar(rutaImagen(PIEZA, clave, 'mini'), fecha);
};
const barrer = (a: AlmacenImagenes, referenciadas: string[], extra = {}) =>
  barrerImagenesHuerfanas({
    almacen: a,
    clavesReferenciadas: async () => new Set(referenciadas),
    ahora: AHORA,
    ...extra,
  });

describe('barrerImagenesHuerfanas', () => {
  it('conserva lo referenciado y lo reciente; borra lo huérfano de más de 24 h', async () => {
    const a = crearAlmacenMemoria();
    sembrarFoto(a, uuid(10), hace(100)); // referenciada (vieja)
    sembrarFoto(a, uuid(11), hace(48)); // huérfana vieja: se borra
    sembrarFoto(a, uuid(12), hace(2)); // huérfana reciente (subida en curso): se queda
    const r = await barrer(a, [uuid(10)]);
    expect(r).toEqual({
      revisados: 6,
      referenciados: 2,
      recientes: 2,
      desconocidos: 0,
      huerfanos: 2,
      borrados: 2,
      truncado: false,
      simulado: false,
    });
    expect(a.rutas().some((x) => x.includes(uuid(11)))).toBe(false);
    expect(a.rutas()).toHaveLength(4);
  });

  it('el margen es estricto: exactamente 24 h todavía no se borra', async () => {
    const a = crearAlmacenMemoria();
    sembrarFoto(a, uuid(20), hace(24));
    expect((await barrer(a, [])).borrados).toBe(0);
    expect(a.rutas()).toHaveLength(2);
  });

  it('simulación: cuenta pero no borra', async () => {
    const a = crearAlmacenMemoria();
    sembrarFoto(a, uuid(30), hace(48));
    const r = await barrer(a, [], { simular: true });
    expect(r).toMatchObject({ huerfanos: 2, borrados: 0, simulado: true });
    expect(a.rutas()).toHaveLength(2);
  });

  it('recorre todas las páginas', async () => {
    const a = crearAlmacenMemoria({ tamPagina: 3 });
    for (let i = 0; i < 5; i++) sembrarFoto(a, uuid(100 + i), hace(48));
    const r = await barrer(a, [uuid(100)]);
    expect(r).toMatchObject({ revisados: 10, borrados: 8, truncado: false });
  });

  it('respeta el tope de borrados por corrida (y la siguiente sigue): idempotente', async () => {
    const a = crearAlmacenMemoria();
    for (let i = 0; i < 5; i++) sembrarFoto(a, uuid(200 + i), hace(48));
    const tope = { maxBorrados: 4, lote: 3 };
    expect(await barrer(a, [uuid(9)], tope)).toMatchObject({ borrados: 4, truncado: true });
    expect(await barrer(a, [uuid(9)], tope)).toMatchObject({ borrados: 4, truncado: true });
    expect(await barrer(a, [uuid(9)], tope)).toMatchObject({ borrados: 2, truncado: false });
    expect(await barrer(a, [])).toMatchObject({ revisados: 0, borrados: 0 });
  });

  it('borra en lotes: un borrar() por lote, nunca uno por blob', async () => {
    const a = crearAlmacenMemoria();
    for (let i = 0; i < 4; i++) sembrarFoto(a, uuid(250 + i), hace(48)); // 8 blobs
    const lotes: number[] = [];
    const espia: AlmacenImagenes = {
      ...a,
      borrar: async (rutas) => {
        lotes.push(rutas.length);
        await a.borrar(rutas);
      },
    };
    await barrer(espia, [uuid(9)], { lote: 3 });
    expect(lotes).toEqual([3, 3, 2]);
  });

  it('respeta el tope de páginas', async () => {
    const a = crearAlmacenMemoria({ tamPagina: 2 });
    for (let i = 0; i < 3; i++) sembrarFoto(a, uuid(300 + i), hace(48));
    expect(await barrer(a, [uuid(9)], { maxPaginas: 1 })).toMatchObject({
      revisados: 2,
      borrados: 2,
      truncado: true,
    });
  });

  it('una ruta desconocida bajo piezas/ se cuenta y nunca se borra', async () => {
    const borradas: string[] = [];
    const almacen: AlmacenImagenes = {
      guardar: async () => undefined,
      leer: async () => null,
      borrar: async (rutas) => {
        borradas.push(...rutas);
      },
      listar: async () => ({
        objetos: [{ ruta: 'piezas/leeme.txt', subidoEn: hace(1000), bytes: 1 }],
        siguiente: null,
      }),
    };
    expect(await barrer(almacen, [])).toMatchObject({
      revisados: 1,
      desconocidos: 1,
      huerfanos: 0,
      borrados: 0,
    });
    expect(borradas).toEqual([]);
  });

  it('solo lista bajo piezas/ (nada más se toca)', async () => {
    const prefijos: string[] = [];
    const almacen: AlmacenImagenes = {
      guardar: async () => undefined,
      leer: async () => null,
      borrar: async () => undefined,
      listar: async (prefijo) => {
        prefijos.push(prefijo);
        return { objetos: [], siguiente: null };
      },
    };
    await barrer(almacen, []);
    expect(prefijos).toEqual(['piezas/']);
  });

  it('lee las claves vigentes DESPUÉS de listar (una foto adoptada durante el listado queda protegida)', async () => {
    const orden: string[] = [];
    const base = crearAlmacenMemoria();
    const almacen: AlmacenImagenes = {
      ...base,
      listar: async (...args) => {
        orden.push('listar');
        return base.listar(...args);
      },
    };
    await barrerImagenesHuerfanas({
      almacen,
      clavesReferenciadas: async () => {
        orden.push('claves');
        return new Set();
      },
      ahora: AHORA,
    });
    expect(orden).toEqual(['listar', 'claves']);
  });

  it('si la BD falla, no borra nada (falla cerrado)', async () => {
    const a = crearAlmacenMemoria();
    sembrarFoto(a, uuid(40), hace(48));
    await expect(
      barrerImagenesHuerfanas({
        almacen: a,
        clavesReferenciadas: async () => {
          throw new Error('ECONNRESET');
        },
        ahora: AHORA,
      }),
    ).rejects.toThrow();
    expect(a.rutas()).toHaveLength(2);
  });

  it('si el almacén falla al listar, no borra nada', async () => {
    const a = crearAlmacenMemoria({ fallarAlListar: true });
    sembrarFoto(a, uuid(50), hace(48));
    await expect(barrer(a, [])).rejects.toThrow();
    expect(a.rutas()).toHaveLength(2);
  });

  describe('guarda contra una BD equivocada o vacía', () => {
    it('referenciadas vacío con candidatos: aborta sin borrar', async () => {
      const a = crearAlmacenMemoria();
      sembrarFoto(a, uuid(11), hace(48));
      const r = await barrer(a, []);
      expect(r).toMatchObject({ abortado: 'sospechoso', huerfanos: 2, borrados: 0 });
      expect((await a.listar('piezas/')).objetos).toHaveLength(2);
    });
    it('más del 50 % de los blobs (y más de 20) como huérfanos: aborta sin borrar', async () => {
      const a = crearAlmacenMemoria();
      sembrarFoto(a, uuid(10), hace(100)); // referenciada
      for (let n = 0; n < 11; n++) sembrarFoto(a, uuid(200 + n), hace(48)); // 22 huérfanos de 24
      const r = await barrer(a, [uuid(10)]);
      expect(r).toMatchObject({ abortado: 'sospechoso', huerfanos: 22, borrados: 0 });
      expect((await a.listar('piezas/')).objetos).toHaveLength(24);
    });
    it('pocos huérfanos (<= 20) aunque sean mayoría: sí borra', async () => {
      const a = crearAlmacenMemoria();
      sembrarFoto(a, uuid(10), hace(100));
      for (let n = 0; n < 5; n++) sembrarFoto(a, uuid(200 + n), hace(48));
      const r = await barrer(a, [uuid(10)]);
      expect(r.abortado).toBeUndefined();
      expect(r.borrados).toBe(10);
    });
    it('sin candidatos y sin referenciadas no es sospechoso', async () => {
      const r = await barrer(crearAlmacenMemoria(), []);
      expect(r.abortado).toBeUndefined();
    });
  });
});
