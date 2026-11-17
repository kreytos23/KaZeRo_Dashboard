import Link from 'next/link';
import { formatoFolio, formatoPct } from '@/domain/pedidos';
import type { Casilla, Tarjeta } from '@/domain/lealtad';
import { Anillo, Collar, Flor } from './iconos-lealtad';
import { etiquetaCasilla, pieTarjeta } from './texto-lealtad';

function Icono({ k }: { k: Casilla }) {
  let color = 'text-borde-campo';
  if (k.pctBps > 0) color = 'text-secundario';
  else if (k.estado === 'ocupada') color = 'text-primario';
  else if (k.estado === 'previa') color = 'text-tinta-suave';
  const clase = `size-8 ${color}`;
  if (k.pctBps === 1000) return <Anillo className={clase} />;
  if (k.pctBps === 2000) return <Collar className={clase} />;
  return <Flor llena={k.estado !== 'libre'} className={clase} />;
}

/** Tarjeta de lealtad (R-25, D-4). Server Component sin JS: una sola fila de 10 lugares, la tarjeta actual; los lugares de papel salen como «anterior». */
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
            className={`relative flex min-h-24 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1 text-center ${
              k.estado === 'libre' ? 'border-dashed bg-crema' : 'bg-superficie'
            } ${
              k.pctBps > 0
                ? 'border-secundario'
                : k.estado === 'libre'
                  ? 'border-borde-campo'
                  : 'border-borde'
            }`}
          >
            {k.conSaldo && (
              <span
                aria-hidden="true"
                className="absolute -top-2 right-1 whitespace-nowrap rounded border border-aviso-borde bg-aviso-fondo px-1 text-[0.6875rem] leading-tight text-aviso"
              >
                con saldo
              </span>
            )}
            <Icono k={k} />
            <span aria-hidden="true" className="text-meta text-tinta-suave">
              {k.pctBps > 0 ? `${k.posicion} · ${formatoPct(k.pctBps)}` : k.posicion}
            </span>
            {k.estado === 'previa' && (
              <span aria-hidden="true" className="text-meta text-tinta-suave">
                anterior
              </span>
            )}
            {k.folio !== null && (
              <Link
                href={`/panel/pedidos/${k.folio}`}
                className="enlace text-meta font-semibold after:absolute after:inset-0 after:content-['']"
              >
                {formatoFolio(k.folio)}
              </Link>
            )}
          </li>
        ))}
      </ol>
      <p className="text-meta text-tinta-suave">{pieTarjeta(tarjeta)}</p>
    </section>
  );
}
