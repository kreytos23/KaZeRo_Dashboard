import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_BYTES_SUBIDA } from '@/domain/imagenes';
import { bytesDeArchivo, ejecutarAccion, texto, uuidDe, uuidOpcionalDe, versionDe } from '@/server/acciones';
import { ErrorNegocio } from '@/server/errores';

describe('ejecutarAccion', () => {
  afterEach(() => vi.restoreAllMocks());
  it('devuelve el mensaje de éxito', async () => {
    expect(await ejecutarAccion(async () => 'Vendedor agregado.')).toEqual({ ok: 'Vendedor agregado.' });
  });
  it('usa un mensaje por defecto si la acción no devuelve texto', async () => {
    expect(await ejecutarAccion(async () => {})).toEqual({ ok: 'Guardado.' });
  });
  it('muestra el mensaje de un ErrorNegocio', async () => {
    expect(
      await ejecutarAccion(async () => {
        throw new ErrorNegocio('x', 'Ya existe.');
      }),
    ).toEqual({ error: 'Ya existe.' });
  });
  it('un ErrorNegocio con campo se devuelve también por campo', async () => {
    expect(
      await ejecutarAccion(async () => {
        throw new ErrorNegocio('x', 'Ya existe.', 'nombre');
      }),
    ).toEqual({ error: 'Ya existe.', campos: { nombre: 'Ya existe.' } });
  });
  it('un error inesperado da un mensaje genérico y no loguea su texto (podría traer datos)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await ejecutarAccion(async () => {
      throw new Error('password=secreto');
    });
    expect(r).toEqual({ error: 'No se pudo guardar. Intenta de nuevo.' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secreto');
  });
  it('de un error de Postgres loguea solo el SQLSTATE', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ejecutarAccion(async () => {
      throw new Error('Failed query: valor=secreto', { cause: { code: '23514', detail: 'secreto' } });
    });
    const salida = JSON.stringify(log.mock.calls);
    expect(salida).toContain('23514');
    expect(salida).not.toContain('secreto');
  });
});

describe('texto', () => {
  it('lee cadenas y devuelve vacío para ausentes o archivos', () => {
    const fd = new FormData();
    fd.set('a', 'hola');
    fd.set('f', new Blob(['x']), 'x.txt');
    expect(texto(fd, 'a')).toBe('hola');
    expect(texto(fd, 'f')).toBe('');
    expect(texto(fd, 'nada')).toBe('');
  });
});

describe('lectores de campos ocultos', () => {
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  const ID = '0b5b3e2a-6d0e-4b7a-9f3a-1c2d3e4f5a6b';
  it('uuidDe acepta uuid y rechaza basura', () => {
    expect(uuidDe(fd({ id: ID }), 'id')).toBe(ID);
    expect(() => uuidDe(fd({ id: "1' OR 1=1" }), 'id')).toThrow(ErrorNegocio);
    expect(() => uuidDe(fd({}), 'id')).toThrow(ErrorNegocio);
  });
  it('uuidOpcionalDe da null si está vacío', () => {
    expect(uuidOpcionalDe(fd({ v: '' }), 'v')).toBeNull();
    expect(uuidOpcionalDe(fd({}), 'v')).toBeNull();
    expect(uuidOpcionalDe(fd({ v: ID }), 'v')).toBe(ID);
    expect(() => uuidOpcionalDe(fd({ v: 'x' }), 'v')).toThrow(ErrorNegocio);
  });
  it('versionDe exige un entero', () => {
    expect(versionDe(fd({ version: '3' }))).toBe(3);
    for (const malo of ['', '-1', '1.5', 'abc', '99999999999']) {
      expect(() => versionDe(fd({ version: malo }))).toThrow(ErrorNegocio);
    }
  });
});

describe('bytesDeArchivo', () => {
  const fd = (v?: File | string) => {
    const f = new FormData();
    if (v !== undefined) f.set('imagen', v);
    return f;
  };
  it('archivo → bytes', async () => {
    expect(await bytesDeArchivo(fd(new File([Uint8Array.of(1, 2)], 'x.jpg')), 'imagen')).toEqual(
      Uint8Array.of(1, 2),
    );
  });
  it('ausente, vacío o texto: error en el campo; opcional → null', async () => {
    for (const v of [undefined, new File([], 'x.jpg'), 'texto']) {
      await expect(bytesDeArchivo(fd(v), 'imagen')).rejects.toMatchObject({
        campo: 'imagen',
        message: 'Elige una foto.',
      });
      expect(await bytesDeArchivo(fd(v), 'imagen', { opcional: true })).toBeNull();
    }
  });
  it('más de 3 MB: se rechaza sin leer el contenido (también si es opcional)', async () => {
    const enorme = new File([new Uint8Array(MAX_BYTES_SUBIDA + 1)], 'x.jpg');
    const leer = vi.spyOn(enorme, 'arrayBuffer');
    await expect(bytesDeArchivo(fd(enorme), 'imagen')).rejects.toMatchObject({
      campo: 'imagen',
      message: 'La foto pesa más de 3 MB.',
    });
    await expect(bytesDeArchivo(fd(enorme), 'imagen', { opcional: true })).rejects.toMatchObject({
      campo: 'imagen',
    });
    expect(leer).not.toHaveBeenCalled();
  });
  it('justo 3 MB se acepta', async () => {
    const tope = new File([new Uint8Array(MAX_BYTES_SUBIDA)], 'x.jpg');
    expect((await bytesDeArchivo(fd(tope), 'imagen'))!.length).toBe(MAX_BYTES_SUBIDA);
  });
});
