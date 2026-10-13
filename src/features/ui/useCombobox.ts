'use client';

import { useState, type KeyboardEvent } from 'react';

/**
 * Teclado y aria compartidos por los combobox con listbox (WAI-ARIA 1.2): BuscadorGlobal y CampoConLista.
 * Flechas mueven la opción activa (ArrowDown abre si estaba cerrada), Enter elige, Escape cierra sin borrar.
 * `activoInicial: -1` deja la lista sin opción activa hasta que la persona navegue (Enter entonces no elige
 * nada y el formulario se envía como siempre); `0` activa la primera de entrada (buscador).
 */
export function useCombobox({
  id,
  cantidad,
  abierto,
  setAbierto,
  alElegir,
  activoInicial = 0,
}: {
  id: string;
  cantidad: number;
  abierto: boolean;
  setAbierto: (v: boolean) => void;
  alElegir: (indice: number) => void;
  activoInicial?: 0 | -1;
}) {
  const [activo, setActivo] = useState<number>(activoInicial);
  const visible = abierto && cantidad > 0;
  // Siempre dentro de rango aunque las opciones cambien (p. ej. 0 resultados).
  const sel = cantidad === 0 ? -1 : Math.max(activoInicial === 0 ? 0 : -1, Math.min(activo, cantidad - 1));
  const idOpcion = (i: number) => `${id}-op-${i}`;

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!abierto) setAbierto(true);
      else setActivo(Math.min(sel + 1, cantidad - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!abierto) setAbierto(true);
      else setActivo(sel < 0 ? cantidad - 1 : Math.max(sel - 1, 0));
    } else if (e.key === 'Enter' && visible && sel >= 0) {
      e.preventDefault();
      alElegir(sel);
    } else if (e.key === 'Escape' && abierto) {
      // Solo cierra la lista; no se propaga para no cerrar un diálogo contenedor.
      e.stopPropagation();
      setAbierto(false);
    }
  }

  return {
    sel,
    setActivo,
    reiniciar: () => setActivo(activoInicial),
    visible,
    idLista: `${id}-lista`,
    idOpcion,
    idActivo: visible && sel >= 0 ? idOpcion(sel) : undefined,
    onKeyDown,
  };
}
