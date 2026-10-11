// Letras que unaccent de Postgres transforma y que NFD no descompone.
const ESPECIALES: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  ø: 'o',
  Ø: 'o',
  ł: 'l',
  Ł: 'l',
  đ: 'd',
  Đ: 'd',
};

/** Debe producir lo mismo que la función SQL kz_normalizar (migración 0003): así coinciden búsquedas y unicidad. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[ßæÆœŒøØłŁđĐ]/g, (c) => ESPECIALES[c]!)
    .toLowerCase()
    .replace(/[ \t\n\r\f\v\u00A0]+/g, ' ')
    .replace(/^ | $/g, '');
}

/** Para `LIKE … ESCAPE '\'`: sin esto, un % o _ escrito por el usuario actúa como comodín. */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}
