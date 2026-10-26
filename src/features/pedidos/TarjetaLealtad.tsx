import Link from 'next/link';
import { formatoFolio, formatoPct } from '@/domain/pedidos';
import type { Tarjeta } from '@/domain/lealtad';
import { etiquetaCasilla } from './texto-lealtad';

const SIMBOLO = { ocupada: '●', libre: '○' } as const;

/** Tarjeta de lealtad (R-25, D-4). Server Component sin JS: una sola fila de 10 lugares, la tarjeta actual. */
export function TarjetaLealtad({ tarjeta }: { tarjeta: Tarjeta }) {
  return (
    <section aria-labelledby="tarjeta-lealtad" className="tarjeta @container flex flex-col gap-3 p-4">
      <h2 id="tarjeta-lealtad" className="text-lg font-semibold">
        Tarjeta de lealtad
      </h2>
      <ol aria-label="Lugares de la tarjeta" className="grid grid-cols-5 gap-2 @2xl:grid-cols-10">
        {tarjeta.casillas.map((k) => (
          <li
            key={k.posicion}
            aria-label={etiquetaCasilla(k)}
            className="relative flex min-h-20 flex-col items-center justify-center rounded-lg border border-borde bg-white px-1 py-1 text-center"
          >
            <span aria-hidden="true" className="text-xl leading-none text-primario">
              {SIMBOLO[k.estado]}
            </span>
            <span aria-hidden="true" className="text-meta text-tinta-suave">
              {k.posicion}
            </span>
            {k.folio !== null ? (
              <Link
                href={`/panel/pedidos/${k.folio}`}
                className="enlace text-meta font-semibold after:absolute after:inset-0 after:content-['']"
              >
                {formatoFolio(k.folio)}
              </Link>
            ) : (
              k.pctBps > 0 && (
                <span aria-hidden="true" className="text-meta font-medium">
                  {formatoPct(k.pctBps)}
                </span>
              )
            )}
            {k.conSaldo && (
              <span
                aria-hidden="true"
                title="con saldo"
                className="absolute right-1 top-1 size-2 rounded-full bg-aviso"
              />
            )}
          </li>
        ))}
      </ol>
      <p className="text-meta text-tinta-suave">{tarjeta.ocupadas} de 10</p>
      <p className="text-meta text-tinta-suave">● ocupado · ○ libre · punto ámbar: con saldo</p>
    </section>
  );
}
