'use client';

import { useSyncExternalStore } from 'react';

/** Puntero fino y pantalla ancha: ahí los selectores y fechas usan los componentes de escritorio. */
export const CONSULTA_ESCRITORIO = '(pointer: fine) and (min-width: 1024px)';

function suscribir(aviso: () => void) {
  const mq = window.matchMedia(CONSULTA_ESCRITORIO);
  mq.addEventListener('change', aviso);
  return () => mq.removeEventListener('change', aviso);
}

/**
 * `false` en el servidor, durante la hidratación y en celular; `true` en escritorio. Así el primer pintado
 * es el control nativo (sin discrepancia de hidratación) y, ya montado, se cambia al componente de escritorio.
 */
export function useEscritorio(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(CONSULTA_ESCRITORIO).matches,
    () => false,
  );
}
