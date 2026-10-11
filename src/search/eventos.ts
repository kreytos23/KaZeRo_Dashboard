export const EVENTO_INDICE_SUCIO = 'kazero:indice-sucio';

/** Lo llaman los formularios tras guardar: el buscador recarga su índice. */
export function marcarIndiceSucio(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_INDICE_SUCIO));
}
