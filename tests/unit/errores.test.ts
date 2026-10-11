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
  it('traduce interbloqueos y fallos de serialización', () => {
    for (const code of ['40P01', '40001']) {
      const e = traducirErrorPg(envuelto({ code }));
      expect(e?.codigo).toBe('conflicto_concurrente');
      expect(e?.message).toBe('Otra operación modificó estos datos al mismo tiempo. Intenta de nuevo.');
    }
  });
  it('traduce un uuid inválido como registro no encontrado', () => {
    const e = traducirErrorPg(envuelto({ code: '22P02' }));
    expect(e?.codigo).toBe('no_encontrado');
    expect(e?.message).toBe('Registro no encontrado.');
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
