import { describe, expect, it } from 'vitest';
import { describirError } from '../../scripts/lib/describir-error';

describe('describirError', () => {
  it('un error de consulta de Drizzle no filtra los parámetros de su mensaje', () => {
    const e = new Error('Failed query: insert into cliente (nombre) values ($1)\nparams: Ana Pérez,555-1234');
    e.name = 'DrizzleQueryError';
    const texto = describirError(e);
    expect(texto).toBe('DrizzleQueryError');
    expect(texto).not.toContain('Ana');
    expect(texto).not.toContain('555');
  });

  it('con causa no-pg imprime solo la etiqueta segura de la causa', () => {
    const e = new Error('Failed query: select ...\nparams: Ana Pérez', { cause: new TypeError('Ana Pérez') });
    e.name = 'DrizzleQueryError';
    const texto = describirError(e);
    expect(texto).toBe('DrizzleQueryError: TypeError');
    expect(texto).not.toContain('Ana');
  });

  it('un error de pg imprime solo código y constraint', () => {
    const pg = Object.assign(new Error('duplicate key value (Ana Pérez)'), {
      code: '23505',
      constraint: 'cliente_nombre_uq',
    });
    const e = new Error('Failed query: ...\nparams: Ana Pérez', { cause: pg });
    e.name = 'DrizzleQueryError';
    const texto = describirError(e);
    expect(texto).toContain('23505');
    expect(texto).toContain('(cliente_nombre_uq)');
    expect(texto).not.toContain('Ana');
  });

  it('un error común conserva nombre y mensaje', () => {
    expect(describirError(new Error('boom'))).toBe('Error: boom');
    expect(describirError('x')).toBe('Error desconocido');
  });
});
