export const EVENTO_INDICE_SUCIO = 'kazero:indice-sucio';

/**
 * Toda mutación (alta, edición, venta, etc.) DEBE llamar a `marcarIndiceSucio()` tras guardar con éxito:
 * es la única señal que recarga el índice del buscador (no se recarga al navegar).
 */
export function marcarIndiceSucio(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_INDICE_SUCIO));
}
