import { describe, expect, it } from 'vitest';
import {
  esCodigoValido,
  esPrefijoValido,
  normalizarCodigo,
  separarCodigo,
  siguienteCodigo,
} from '@/domain/codigos';

describe('códigos de pieza (R-01)', () => {
  it('normaliza a mayúsculas sin espacios', () => {
    expect(normalizarCodigo(' af 12 ')).toBe('AF12');
  });
  it.each(['AA01', 'AN100', 'F025', '159', 'AB-7'])('acepta %s', (c) => expect(esCodigoValido(c)).toBe(true));
  it.each(['', '-A1', 'aa01', 'A'.repeat(21), 'A B'])('rechaza %j', (c) =>
    expect(esCodigoValido(c)).toBe(false),
  );
  it('separa prefijo, número y ancho', () => {
    expect(separarCodigo('AN100')).toEqual({ prefijo: 'AN', numero: 100, ancho: 3 });
    expect(separarCodigo('159')).toBeNull();
  });
  it('sugiere el siguiente consecutivo del prefijo: AI29 → AI30', () => {
    expect(siguienteCodigo('AI', ['AI28', 'AI29', 'AH99'])).toBe('AI30');
  });
  it('respeta el ancho más grande del prefijo', () => {
    expect(siguienteCodigo('AN', ['AN99', 'AN100'])).toBe('AN101');
    expect(siguienteCodigo('F', ['F025'])).toBe('F026');
  });
  it('sin códigos previos empieza en 01', () => {
    expect(siguienteCodigo('zz', [])).toBe('ZZ01');
  });
  it('valida prefijos: solo 1 a 6 letras', () => {
    expect(esPrefijoValido('AI')).toBe(true);
    expect(esPrefijoValido('A1')).toBe(false);
    expect(esPrefijoValido('ABCDEFG')).toBe(false);
  });
});
