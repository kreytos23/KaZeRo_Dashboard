import { describe, expect, it } from 'vitest';
import { ErrorNegocio, conErroresDeNegocio, traducirErrorPg } from '@/server/errores';

const envuelto = (pg: object) => new Error('Failed query', { cause: pg });

describe('traducción de errores de Postgres', () => {
  it('traduce la violación de código único', () => {
    const e = traducirErrorPg(envuelto({ code: '23505', constraint: 'pieza_codigo_uq' }));
    expect(e).toBeInstanceOf(ErrorNegocio);
    expect(e?.message).toBe('Ya existe una pieza con ese código.');
  });
  it('traduce la transición de pieza rechazada por el trigger', () => {
    expect(traducirErrorPg(envuelto({ code: 'P0001', constraint: 'pieza_transicion' }))?.codigo).toBe(
      'pieza_transicion',
    );
  });
  it('no inventa traducciones para errores desconocidos', () => {
    expect(traducirErrorPg(new Error('x'))).toBeNull();
  });
  it('conErroresDeNegocio convierte y relanza', async () => {
    await expect(
      conErroresDeNegocio(async () => {
        throw envuelto({ code: '23505', constraint: 'vendedor_nombre_uq' });
      }),
    ).rejects.toThrow('Ya existe un vendedor con ese nombre.');
  });
});
