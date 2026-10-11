import { describe, expect, it } from 'vitest';
import { MAX_CARACTERES_CODIGOS, partirCodigos } from '@/features/exhibidores/codigos';

describe('partirCodigos', () => {
  it('parte por saltos de línea, comas, espacios y tabuladores', () => {
    expect(partirCodigos('A1\nB2,C3 D4\tE5\r\nF6')).toEqual(['A1', 'B2', 'C3', 'D4', 'E5', 'F6']);
  });
  it('ignora separadores repetidos y vacíos', () => {
    expect(partirCodigos(' ,, A1 ,\n\n, B2 ,')).toEqual(['A1', 'B2']);
    expect(partirCodigos('')).toEqual([]);
    expect(partirCodigos(' \n\t, ')).toEqual([]);
  });
  it('rechaza un texto por encima del tope antes de partirlo', () => {
    expect(partirCodigos('A'.repeat(MAX_CARACTERES_CODIGOS))).toHaveLength(1);
    expect(() => partirCodigos('A'.repeat(MAX_CARACTERES_CODIGOS + 1))).toThrow(/demasiado grande/);
  });
});
