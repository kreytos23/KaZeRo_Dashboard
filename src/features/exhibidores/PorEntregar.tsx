import { formatoMXN } from '@/domain/dinero';

/** Dinero que el exhibidor debe entregar: con monto va destacado (ámbar y «!»), en cero se atenúa. */
export function PorEntregar({
  centavos,
  tamano = 'monto',
  className = '',
}: {
  centavos: number;
  tamano?: 'monto' | 'destacado';
  className?: string;
}) {
  const monto = formatoMXN(centavos);
  if (centavos <= 0) return <span className={`tabular-nums text-tinta-suave ${className}`}>{monto}</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border border-aviso-borde bg-aviso-fondo px-2 py-0.5 font-bold text-aviso tabular-nums ${
        tamano === 'destacado' ? 'text-destacado' : 'text-monto'
      } ${className}`}
    >
      <span aria-hidden="true" className="font-black">
        !
      </span>
      <span className="sr-only">Por entregar: </span>
      {monto}
    </span>
  );
}
