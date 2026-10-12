import { describe, expect, it } from 'vitest';
import { hashPayload, jsonCanonico } from '@/server/idempotencia';

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
