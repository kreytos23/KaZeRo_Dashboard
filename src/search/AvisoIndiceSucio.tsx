'use client';

import { useEffect, useRef } from 'react';
import { marcarIndiceSucio } from './eventos';

/**
 * Marca el índice de búsqueda como sucio cuando cambia la versión del registro de la ficha (no al montar).
 * Cubre las acciones cuyo formulario se desmonta en el mismo render que trae su respuesta (p. ej. pasar a
 * "regalo" deja sin destinos el formulario de estado): ahí el useEffect de FormAccion nunca corre.
 */
export function AvisoIndiceSucio({ version }: { version: number }) {
  const anterior = useRef(version);
  useEffect(() => {
    if (anterior.current !== version) marcarIndiceSucio();
    anterior.current = version;
  }, [version]);
  return null;
}
