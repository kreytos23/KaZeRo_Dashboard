import { describe, expect, it } from 'vitest';
import { escaparLike, normalizar } from '@/domain/texto';

describe('normalizar', () => {
  it.each([
    ['  Rocío   Santibañez ', 'rocio santibanez'],
    ['ORO LAMINADO', 'oro laminado'],
    ['Danya\t5to  norte', 'danya 5to norte'],
    ['', ''],
    ['\tabc\n', 'abc'],
    ['straße Ø Łódź', 'strasse o lodz'],
    ['a  b', 'a b'],
    ['ÁÉÍÓÚ Üñ', 'aeiou un'],
    ['a\u3000b', 'a\u3000b'],
    ['\u2003x\u2003', '\u2003x\u2003'],
  ])('%j → %j', (entrada, salida) => expect(normalizar(entrada)).toBe(salida));
});

describe('escaparLike', () => {
  it('escapa comodines y la barra para usarlos con ESCAPE', () => {
    expect(escaparLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});
