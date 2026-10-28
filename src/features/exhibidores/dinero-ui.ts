import { formatoMXN, pesosACentavos } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';

/** '+$150.00' para lo que suma al por entregar (cobros), '−$50.00' para lo que resta (entregas); el ajuste lleva su signo. */
export function montoMovimiento(tipo: 'cobro' | 'entrega' | 'ajuste', centavos: number): string {
  const resta = tipo === 'entrega' || (tipo === 'ajuste' && centavos < 0);
  return `${resta ? '−' : '+'}${formatoMXN(Math.abs(centavos))}`;
}

/** Texto de un renglón del historial de dinero del exhibidor. */
export function rotuloMovimiento(m: {
  tipo: 'cobro' | 'entrega' | 'ajuste';
  folio: number | null;
  clienteNombre: string | null;
  metodo: string | null;
  nota: string | null;
}): string {
  switch (m.tipo) {
    case 'cobro': {
      const base = m.folio === null ? 'Cobro' : `Cobro de ${formatoFolio(m.folio)}`;
      return m.clienteNombre ? `${base} · ${m.clienteNombre}` : base;
    }
    case 'entrega':
      return m.metodo ? `Entrega (${m.metodo})` : 'Entrega';
    case 'ajuste':
      return m.nota ? `Ajuste: ${m.nota}` : 'Ajuste';
  }
}

/** Ajuste con signo a partir del formulario (dirección + monto positivo); null si algo no es válido. */
export function montoAjusteCentavos(direccion: string, pesos: string): number | null {
  if (direccion !== 'suma' && direccion !== 'resta') return null;
  const c = pesosACentavos(pesos);
  if (c === null || c === 0) return null;
  return direccion === 'suma' ? c : -c;
}
