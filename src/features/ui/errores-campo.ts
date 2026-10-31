'use client';

import { createContext, useEffect, type RefObject } from 'react';
import type { EstadoAccion } from './estado';

/** Errores de validación por nombre de campo; los provee el formulario y los lee cada `<Campo>`. */
export const ErroresCampo = createContext<Record<string, string>>({});

/** Resultado completo de la última acción del formulario (código y detalle del error); lo provee `FormAccion`. */
export const EstadoDeAccion = createContext<EstadoAccion>({});

/**
 * Sacudida breve del control con error (receta 12-error-state-shake de transitions.dev). Se reinicia la
 * animación quitando la clase, forzando un reflujo y volviéndola a poner; con «menos movimiento» el CSS la anula.
 */
export function sacudir(el: HTMLElement) {
  el.classList.remove('sacudida');
  void el.offsetWidth;
  el.classList.add('sacudida');
  el.addEventListener('animationend', () => el.classList.remove('sacudida'), { once: true });
}

/** Tras un error por campo, mueve el foco al primer control inválido del formulario y lo sacude. */
export function useEnfocarPrimerInvalido(form: RefObject<HTMLFormElement | null>, estado: EstadoAccion) {
  useEffect(() => {
    if (!estado.campos) return;
    const primero = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!primero) return;
    primero.focus();
    sacudir(primero);
  }, [estado, form]);
}
