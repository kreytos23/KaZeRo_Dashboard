import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';

export interface MovimientoTexto {
  tipo: 'cancelacion' | 'sobrante' | 'uso' | 'devolucion' | 'retiro';
  pedidoFolio: number | null;
  devolucionMotivo: string | null;
  nota: string | null;
}

/** Texto legible de un renglón del libro de saldo a favor (ficha del cliente). */
export function textoMovimientoSaldo(m: MovimientoTexto): string {
  const folio = m.pedidoFolio === null ? null : formatoFolio(m.pedidoFolio);
  const con = (base: string, detalle: string | null) => (detalle ? `${base}: ${detalle}` : base);
  switch (m.tipo) {
    case 'cancelacion':
      return folio ? `Cancelación de ${folio}` : 'Cancelación';
    case 'devolucion':
      return con(folio ? `Devolución de ${folio}` : 'Devolución', m.devolucionMotivo);
    case 'uso':
      return folio ? `Usado en ${folio}` : 'Usado en un pedido';
    case 'retiro':
      return con('Retiro en efectivo', m.nota);
    case 'sobrante':
      return folio ? `Sobrante de pago en ${folio}` : 'Sobrante de pago';
  }
}

/** '100.00' → '+$100.00'; '-250.50' → '−$250.50' (signo menos tipográfico). */
export function montoConSigno(monto: string): string {
  return monto.startsWith('-')
    ? `−${formatoMXN(numericACentavos(monto.slice(1)))}`
    : `+${formatoMXN(numericACentavos(monto))}`;
}
