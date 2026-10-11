import { describe, expect, it } from 'vitest';
import { avisoDeMotivo } from '@/app/login/motivo';

describe('avisoDeMotivo', () => {
  it('solo reconoce el motivo "bloqueado"', () => {
    expect(avisoDeMotivo('bloqueado')).toBe('Demasiados intentos. Intenta más tarde.');
  });
  it('ignora cualquier otro valor y nunca lo refleja', () => {
    for (const v of ['Bloqueado', 'bloqueado ', '<b>x</b>', '', undefined, ['bloqueado'], 'otro']) {
      expect(avisoDeMotivo(v)).toBeNull();
    }
  });
});
