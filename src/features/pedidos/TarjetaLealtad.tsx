import { formatoPct } from '@/domain/pedidos';
import type { Tarjeta } from '@/domain/lealtad';
import { etiquetaCasilla } from './texto-lealtad';

const SIMBOLO = { ocupada: '●', libre: '○' } as const;

function Casillas({ c }: { c: Tarjeta }) {
  return (
    <div className="flex flex-col gap-1">
      <ol aria-label="Tarjeta actual" className="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {c.casillas.map((k) => (
          <li
            key={k.posicion}
            className="flex min-h-14 flex-col items-center justify-center rounded-lg border border-borde bg-white px-1 py-1 text-center"
          >
            <span className="sr-only">{etiquetaCasilla(k)}</span>
            <span aria-hidden="true" className="text-xl leading-none text-primario">
              {SIMBOLO[k.estado]}
            </span>
            <span aria-hidden="true" className="text-xs text-tinta-suave">
              {k.posicion}
            </span>
            {k.pctBps > 0 && (
              <span aria-hidden="true" className="text-xs font-medium">
                −{formatoPct(k.pctBps)}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="text-sm text-tinta-suave">{c.ocupadas} de 10 lugares</p>
    </div>
  );
}

/** Tarjeta de lealtad (R-25, D-4). Server Component sin JS: solo la tarjeta actual, de 10 lugares. */
export function TarjetaLealtad({ tarjeta }: { tarjeta: Tarjeta }) {
  return (
    <section aria-labelledby="tarjeta-lealtad" className="tarjeta flex flex-col gap-3 p-4">
      <h2 id="tarjeta-lealtad" className="text-lg font-semibold">
        Tarjeta de lealtad
      </h2>
      <Casillas c={tarjeta} />
      <p className="text-sm text-tinta-suave">● ocupada · ○ libre</p>
    </section>
  );
}
