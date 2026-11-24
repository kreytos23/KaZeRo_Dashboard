import Link from 'next/link';
import { formatoMXN } from '@/domain/dinero';
import { fechaCorta } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import type { HojaExhibidor as Hoja } from '@/server/reportes/exhibidores';

const ESTADO = { abierto: 'Abierta', liquidado: 'Pagada', cancelado: 'Cancelada' } as const;

function VentasDelMes({ h }: { h: Hoja }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-monto font-semibold">Ventas del mes</h3>
      {h.ventas.length === 0 ? (
        <p className="text-dato text-tinta-suave">Sin ventas en el mes.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-borde text-dato">
          {h.ventas.map((v) => (
            <li key={v.pedidoId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 tabular-nums">
              <Link
                href={`/panel/pedidos/${v.folio}`}
                className="enlace inline-flex min-h-11 items-center font-semibold"
              >
                {formatoFolio(v.folio)}
              </Link>
              <span>{fechaCorta(v.fecha)}</span>
              <span>
                {v.piezas} {v.piezas === 1 ? 'pieza' : 'piezas'}
              </span>
              <span>Total {formatoMXN(v.totalCentavos)}</span>
              <span>Cobrado {formatoMXN(v.cobradoCentavos)}</span>
              <span>Saldo {formatoMXN(v.saldoCentavos)}</span>
              <span className="text-tinta-suave">{ESTADO[v.estado]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Vista en pantalla de la «Relación de ventas» que se imprime para el exhibidor: las piezas que quedan en él con
 * su precio de venta. La columna «Fecha de venta» solo existe en el PDF, porque se llena a mano.
 */
export function HojaExhibidor({ h, ventas, entrega }: { h: Hoja; ventas: boolean; entrega: string }) {
  const n = h.piezasAlCierre.length;
  return (
    <article className="tarjeta flex min-w-0 flex-col gap-5 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-balance break-words">{h.nombre}</h2>
          <p className="text-meta text-tinta-suave">Asociado: {h.vendedorNombre}</p>
        </div>
        <p className="text-meta text-tinta-suave tabular-nums">
          {n} {n === 1 ? 'pieza' : 'piezas'}
        </p>
      </header>
      {n === 0 ? (
        <p className="text-dato text-tinta-suave">No quedaron piezas en el exhibidor.</p>
      ) : (
        <table className="w-full text-left text-dato">
          <caption className="sr-only">Relación de ventas de {h.nombre}</caption>
          <thead className="text-meta font-semibold text-tinta-suave">
            <tr>
              <th scope="col" className="py-2 pr-3">
                ID
              </th>
              <th scope="col" className="py-2 pr-3">
                Descripción
              </th>
              <th scope="col" className="py-2 text-right">
                Precio de venta
              </th>
            </tr>
          </thead>
          <tbody>
            {h.piezasAlCierre.map((z) => (
              <tr key={z.codigo} className="border-t border-borde align-baseline">
                <td className="py-2 pr-3 font-medium whitespace-nowrap">{z.codigo}</td>
                <td className="py-2 pr-3 break-words">{z.descripcion}</td>
                <td className="py-2 text-right whitespace-nowrap tabular-nums">
                  {formatoMXN(z.precioCentavos)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ventas && <VentasDelMes h={h} />}
      <p className="text-meta text-tinta-suave sm:text-right">Fecha de entrega: {entrega}</p>
    </article>
  );
}
