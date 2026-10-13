import { describe, expect, it } from 'vitest';
import { conIdempotencia, hashPayload, jsonCanonico } from '@/server/idempotencia';

describe('jsonCanonico / hashPayload', () => {
  it('ordena llaves en todos los niveles y omite undefined', () => {
    expect(jsonCanonico({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
  it('el mismo payload en otro orden da el mismo hash; otro valor, otro hash', () => {
    expect(hashPayload({ a: 1, b: ['X'] })).toBe(hashPayload({ b: ['X'], a: 1 }));
    expect(hashPayload({ a: 1, b: ['X'] })).not.toBe(hashPayload({ a: 1, b: ['Y'] }));
    expect(hashPayload({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
  it('null y ausente no son lo mismo que 0 o cadena vacía', () => {
    expect(hashPayload({ a: null })).not.toBe(hashPayload({ a: 0 }));
    expect(hashPayload({ a: '' })).not.toBe(hashPayload({}));
  });
});

describe('jsonCanonico: tipos especiales', () => {
  it('Date → ISO y bigint → "Nn", distintos de sus equivalentes en texto o número', () => {
    expect(jsonCanonico({ f: new Date('2026-01-02T03:04:05.000Z') })).toBe(
      '{"f":"2026-01-02T03:04:05.000Z"}',
    );
    expect(jsonCanonico({ n: 12n })).toBe('{"n":"12n"}');
    expect(hashPayload({ n: 12n })).not.toBe(hashPayload({ n: 12 }));
  });
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['función', () => 1],
    ['símbolo', Symbol('x')],
    ['Map', new Map()],
    ['Set', new Set()],
    ['clase', new (class Foo {})()],
    ['fecha inválida', new Date('x')],
  ])('rechaza %s con un error claro', (_n, v) => {
    expect(() => jsonCanonico({ v })).toThrow(/jsonCanonico/);
  });
  it('acepta objetos sin prototipo', () => {
    expect(jsonCanonico(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
  });
});

describe('conIdempotencia: validación previa a la BD', () => {
  const adminId = '11111111-1111-4111-8111-111111111111';
  const tx = {} as never; // si se tocara la BD, esto reventaría con otro error
  it.each([
    ['key no uuid', { key: 'abc', adminId, operacion: 'x', payload: {} }],
    ['adminId no uuid', { key: adminId, adminId: 'zz', operacion: 'x', payload: {} }],
    ['operación vacía', { key: adminId, adminId, operacion: '', payload: {} }],
  ])('%s → Solicitud inválida.', async (_n, o) => {
    await expect(conIdempotencia(tx, o, async () => ({}))).rejects.toThrow('Solicitud inválida.');
  });
});
