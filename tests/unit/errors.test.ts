import { describe, expect, it } from 'vitest';
import { pgCode, pgConstraint } from '@/db/errors';

// Drizzle envuelve el error del driver: el código vive en err.cause, a veces 2 niveles abajo (lecciones §2).
const errorPg = { code: '23505', constraint: 'admin_email_uq', message: 'duplicate key' };

describe('pgCode / pgConstraint', () => {
  it('lee el código en el primer nivel', () => {
    expect(pgCode(errorPg)).toBe('23505');
  });
  it('lo encuentra a dos niveles de cause', () => {
    const envuelto = new Error('Failed query', { cause: new Error('wrap', { cause: errorPg }) });
    expect(pgCode(envuelto)).toBe('23505');
    expect(pgConstraint(envuelto)).toBe('admin_email_uq');
  });
  it('ignora códigos que no son SQLSTATE (p. ej. ECONNRESET)', () => {
    expect(pgCode({ code: 'ECONNRESET' })).toBeUndefined();
  });
  it('no se cicla con causes circulares', () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(pgCode(a)).toBeUndefined();
  });
  it('devuelve undefined para valores no objeto', () => {
    expect(pgCode('x')).toBeUndefined();
    expect(pgCode(null)).toBeUndefined();
  });
});
