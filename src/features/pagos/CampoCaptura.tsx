'use client';

import { useRef } from 'react';
import { SelectorFoto } from '@/features/imagenes/SelectorFoto';

/**
 * Captura del pago (P-3). Reutiliza el selector de fotos de pieza (reduce y convierte en el navegador, también las
 * de iPhone) y deja el archivo ya preparado en un `<input type="file" name="comprobante">` oculto: así el
 * `FormAccion` de siempre la envía junto con los demás campos, sin un envío especial.
 */
export function CampoCaptura({
  etiqueta = 'Captura del pago (opcional)',
  onCambio,
}: {
  etiqueta?: string;
  onCambio?: (hay: boolean) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <>
      <SelectorFoto
        etiqueta={etiqueta}
        campoError="comprobante"
        onCambio={(f) => {
          if (entrada.current) {
            const lista = new DataTransfer();
            if (f) lista.items.add(f);
            entrada.current.files = lista.files;
          }
          onCambio?.(f !== null);
        }}
      />
      <input
        ref={entrada}
        type="file"
        name="comprobante"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );
}
