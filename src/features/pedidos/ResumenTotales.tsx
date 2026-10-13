import { formatoMXN } from '@/domain/dinero';
import type { Totales } from '@/domain/pedidos';

/** Presentacional: los números salen de `calcularTotales` (la misma función que usa el servidor). */
export function ResumenTotales({ totales, textoLealtad }: { totales: Totales; textoLealtad: string }) {
  return (
    <section aria-label="Resumen del pedido" aria-live="polite" className="tarjeta flex flex-col gap-2 p-4">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatoMXN(totales.subtotal)}</dd>
        <dt>Descuento de lealtad</dt>
        <dd className="text-right">−{formatoMXN(totales.descuentoLealtad)}</dd>
        <dt>Descuento manual</dt>
        <dd className="text-right">−{formatoMXN(totales.descuentoManual)}</dd>
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">{formatoMXN(totales.total)}</dd>
      </dl>
      <p className="text-sm text-tinta-suave">{textoLealtad}</p>
      {totales.manualExcede && <p className="aviso-atencion">El descuento manual supera el total.</p>}
    </section>
  );
}
