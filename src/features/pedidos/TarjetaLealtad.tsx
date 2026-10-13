import { formatoPct } from '@/domain/pedidos';
import type { CicloTarjeta } from '@/domain/lealtad';
import { etiquetaCasilla } from './texto-lealtad';

const SIMBOLO = { contada: '●', apartada: '◐', libre: '○' } as const;

function Ciclo({ c }: { c: CicloTarjeta }) {
  return (
    <div className="flex flex-col gap-1">
      <ol aria-label={`Ciclo ${c.ciclo}`} className="grid grid-cols-5 gap-2 sm:grid-cols-10">
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
      <p className="text-sm text-tinta-suave">{c.contadas} de 10 contadas</p>
    </div>
  );
}

/** Tarjeta de lealtad (R-25). Server Component sin JS: el ciclo actual primero, los anteriores plegados. */
export function TarjetaLealtad({ ciclos }: { ciclos: readonly CicloTarjeta[] }) {
  const actual = ciclos[ciclos.length - 1];
  const anteriores = ciclos.slice(0, -1).reverse();
  return (
    <section aria-labelledby="tarjeta-lealtad" className="tarjeta flex flex-col gap-3 p-4">
      <h2 id="tarjeta-lealtad" className="text-lg font-semibold">
        Tarjeta de lealtad
      </h2>
      {actual && <Ciclo c={actual} />}
      <p className="text-sm text-tinta-suave">● contada · ◐ apartada (pendiente de pago) · ○ libre</p>
      {anteriores.map((c) => (
        <details key={c.ciclo}>
          <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
            Ciclo {c.ciclo} ({c.contadas} de 10 contadas)
          </summary>
          <div className="mt-2">
            <Ciclo c={c} />
          </div>
        </details>
      ))}
    </section>
  );
}
