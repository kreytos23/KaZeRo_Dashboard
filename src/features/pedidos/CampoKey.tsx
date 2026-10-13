'use client';

import { useState } from 'react';
import { useHidratado } from '@/features/ui/hidratado';

/**
 * Llave de idempotencia (spec §6): una por montaje del formulario, es decir, por intento de pedido. Los
 * reintentos tras un error reutilizan la misma llave; tras el éxito el formulario se desmonta (redirección)
 * y el siguiente pedido nace con otra.
 */
export function CampoKey() {
  const [key] = useState(() => crypto.randomUUID());
  // Vacía durante el SSR y la hidratación para no desajustar el HTML; el envío ya espera a la hidratación.
  const hidratado = useHidratado();
  return <input type="hidden" name="key" value={hidratado ? key : ''} />;
}
