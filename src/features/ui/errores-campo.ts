'use client';

import { createContext, useEffect, type RefObject } from 'react';
import type { EstadoAccion } from './estado';

/** Errores de validación por nombre de campo; los provee el formulario y los lee cada `<Campo>`. */
export const ErroresCampo = createContext<Record<string, string>>({});

/** Tras un error por campo, mueve el foco al primer control inválido del formulario. */
export function useEnfocarPrimerInvalido(form: RefObject<HTMLFormElement | null>, estado: EstadoAccion) {
  useEffect(() => {
    if (estado.campos) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [estado, form]);
}
