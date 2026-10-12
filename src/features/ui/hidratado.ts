'use client';

import { useSyncExternalStore } from 'react';

const suscribir = () => () => {};

/**
 * `false` en el servidor y durante la hidratación; `true` en cuanto React tomó el control del cliente.
 * Los formularios con `onSubmit` deshabilitan su botón hasta entonces: si el envío ocurriera antes, el
 * navegador haría un envío nativo con todos los campos (¡contraseñas incluidas!) en la URL.
 */
export function useHidratado(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => true,
    () => false,
  );
}
