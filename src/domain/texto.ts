/** Debe producir lo mismo que la función SQL kz_normalizar (migración 0003): así coinciden búsquedas y unicidad. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Para `LIKE … ESCAPE '\'`: sin esto, un % o _ escrito por el usuario actúa como comodín. */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}
