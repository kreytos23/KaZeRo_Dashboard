import Link from 'next/link';
import { formatoMXN } from '@/domain/dinero';
import { fechaCorta } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import type { HojaExhibidor as Hoja } from '@/server/reportes/exhibidores';

const ESTADO = { abierto: 'Abierta', liquidado: 'Pagada', cancelado: 'Cancelada' } as const;

function Cuadre({ titulo, filas }: { titulo: string; filas: [string, string][] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-monto font-semibold">{titulo}</h3>
      <dl className="flex flex-col divide-y divide-borde text-dato tabular-nums">
        {filas.map(([etiqueta, valor], i) => (
          <div
            key={etiqueta}
            className={`flex justify-between gap-4 py-1.5 ${i === filas.length - 1 ? 'font-semibold' : ''}`}
          >
            <dt className="min-w-0">{etiqueta}</dt>
            <dd className="shrink-0">{valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function HojaExhibidor({ h }: { h: Hoja }) {
  const { piezas: p, dinero: d } = h;
  return (
    <article className="tarjeta flex min-w-0 flex-col gap-5 p-4">
      <header>
        <h2 className="text-lg font-semibold break-words">{h.nombre}</h2>
        <p className="text-meta text-tinta-suave">{h.vendedorNombre}</p>
      </header>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        <Cuadre
          titulo="Piezas"
          filas={[
            ['Al inicio', String(p.alInicio)],
            ['Enviadas', String(p.enviadas)],
            ['Vendidas', String(p.vendidas)],
            ['Regresadas', String(p.regresadas)],
            ['Regresadas por cancelación', String(p.porCancelacion)],
            ...(p.otros !== 0 ? ([['Otros movimientos', String(p.otros)]] as [string, string][]) : []),
            ['Al cierre', String(p.alCierre)],
          ]}
        />
        <Cuadre
          titulo="Dinero"
          filas={[
            ['Por entregar al inicio', formatoMXN(d.alInicio)],
            ['Cobrado', formatoMXN(d.cobrado)],
            ['Entregado', formatoMXN(d.entregado)],
            ['Ajustes', formatoMXN(d.ajustes)],
            ['Por entregar al cierre', formatoMXN(d.alCierre)],
          ]}
        />
      </div>
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
      <section className="flex flex-col gap-2">
        <h3 className="text-monto font-semibold">Piezas al cierre</h3>
        {h.piezasAlCierre.length === 0 ? (
          <p className="text-dato text-tinta-suave">No quedaron piezas.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-borde text-dato">
            {h.piezasAlCierre.map((z) => (
              <li key={z.codigo} className="flex items-baseline gap-3 py-1.5">
                <span className="font-medium">{z.codigo}</span>
                <span className="min-w-0 flex-1 break-words text-tinta-suave">{z.descripcion}</span>
                <span className="shrink-0 tabular-nums">{formatoMXN(z.precioCentavos)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
