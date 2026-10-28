import Link from 'next/link';
import { fechaCorta } from '@/domain/fechas';
import type { MovSaldoFavor } from '@/server/saldo-favor/servicio';
import { montoConSigno, textoMovimientoSaldo } from './texto';

/**
 * Libro del saldo a favor (clienta o vendedora), el más reciente primero. Un sobrante o un pago deshecho enlaza a la
 * ficha del pago que lo originó. El signo `+`/`−` y el color verde de las entradas se acompañan siempre del texto.
 */
export function HistorialSaldo({ libro }: { libro: MovSaldoFavor[] }) {
  if (libro.length === 0)
    return <p className="text-meta text-tinta-suave">Sin movimientos de saldo a favor.</p>;
  return (
    <ul aria-label="Historial de saldo a favor" className="tarjeta flex flex-col divide-y divide-borde px-4">
      {libro.map((m) => (
        <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 py-3 text-dato">
          <span className="min-w-0 flex-1">
            {textoMovimientoSaldo(m)}
            <span className="block text-tinta-suave">
              {fechaCorta(m.fecha)}
              {m.adminEmail ? ` · ${m.adminEmail}` : ''}
              {m.pagoId && (
                <>
                  {' · '}
                  <Link href={`/panel/pagos/${m.pagoId}`} className="enlace">
                    Ver pago
                  </Link>
                </>
              )}
            </span>
          </span>
          <span
            className={`text-monto font-semibold tabular-nums ${m.monto.startsWith('-') ? '' : 'text-exito'}`}
          >
            {montoConSigno(m.monto)}
          </span>
        </li>
      ))}
    </ul>
  );
}
