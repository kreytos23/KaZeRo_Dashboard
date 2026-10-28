import { formatoMXN, numericACentavos } from '@/domain/dinero';
import type { EstadoPedido } from '@/server/pedidos/comun';
import { vistaSaldo } from './estado-visual';

/**
 * Saldo de un pedido: con saldo por cobrar va en negrita, más grande y sobre fondo ámbar con signo «!»
 * y la palabra «Saldo»; sin saldo se atenúa. Los montos usan cifras tabulares para alinear los centavos.
 */
export function Saldo({
  estado,
  saldo,
  tamano = 'monto',
  className = '',
}: {
  estado: EstadoPedido;
  /** numeric de la base (p. ej. '347.00'). */
  saldo: string;
  tamano?: 'monto' | 'destacado';
  className?: string;
}) {
  const centavos = numericACentavos(saldo);
  const v = vistaSaldo(estado, centavos);
  const monto = formatoMXN(centavos);
  if (!v.destacado) return <span className={`tabular-nums text-tinta-suave ${className}`}>{monto}</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border border-aviso-borde bg-aviso-fondo px-2 py-0.5 font-bold text-aviso tabular-nums ${
        tamano === 'destacado' ? 'text-destacado' : 'text-monto'
      } ${className}`}
    >
      <span aria-hidden="true" className="font-black">
        !
      </span>
      <span className="sr-only">{v.rotulo}: </span>
      {monto}
    </span>
  );
}
