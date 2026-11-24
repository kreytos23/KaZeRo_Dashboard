import { conDbLectura } from '@/db/client';
import { formatoMXN } from '@/domain/dinero';
import { fechaCorta, hoyMX } from '@/domain/fechas';
import { periodoDeUrl, type FilaTop } from '@/domain/resumen';
import { Campo, Selector } from '@/features/ui/Campo';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { resumenDePeriodo } from '@/server/reportes/resumen';

export const metadata = { title: 'Resumen' };

const OPCIONES = [
  { valor: 'mes', texto: 'Este mes' },
  { valor: 'anterior', texto: 'Mes anterior' },
  { valor: 'anio', texto: 'Este año' },
  { valor: 'rango', texto: 'Rango de fechas' },
];

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <section className="tarjeta flex min-w-0 flex-col gap-1 p-4">
      <h2 className="text-dato text-tinta-suave">{titulo}</h2>
      <p className="text-destacado font-bold tabular-nums">{valor}</p>
      {detalle && <p className="text-meta text-tinta-suave">{detalle}</p>}
    </section>
  );
}

/** Barras de una sola serie: el largo es proporcional al mayor, sin pista de fondo ni animación; el monto va en texto. */
function Top({ titulo, filas }: { titulo: string; filas: FilaTop[] }) {
  const mayor = filas[0]?.centavos ?? 0;
  return (
    <section className="tarjeta flex min-w-0 flex-col gap-3 p-4">
      <h2 className="text-monto font-semibold">{titulo}</h2>
      {filas.length === 0 ? (
        <p className="text-dato text-tinta-suave">Sin ventas en el periodo.</p>
      ) : (
        <ol className="flex flex-col gap-3 text-dato">
          {filas.map((f) => (
            <li key={f.id ?? f.nombre} className="flex flex-col gap-1">
              <div className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{f.nombre}</span>
                <span className="shrink-0 tabular-nums">{formatoMXN(f.centavos)}</span>
              </div>
              <div
                aria-hidden
                className="h-1.5 rounded-full bg-primario"
                style={{ width: `${mayor > 0 ? Math.max((f.centavos / mayor) * 100, 2) : 0}%` }}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function Resumen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const sp = await searchParams;
  const uno = (v: string | string[] | undefined) => (typeof v === 'string' ? v : null);
  const hoy = hoyMX();
  const periodo = periodoDeUrl({ periodo: uno(sp.periodo), desde: uno(sp.desde), hasta: uno(sp.hasta) }, hoy);
  const r = await conDbLectura((db) => resumenDePeriodo(db, { ...periodo, hoy }));
  const pct = r.baseMargenCentavos > 0 ? (r.margenCentavos / r.baseMargenCentavos) * 100 : null;
  // m-2: sin base ni piezas sin costo no hubo ventas en el periodo; «Sin costos» sería falso.
  const sinMargen = r.baseMargenCentavos === 0 && r.piezasSinCosto === 0 ? 'Sin ventas' : 'Sin costos';
  return (
    <div className="flex flex-col gap-6">
      <form
        role="search"
        method="get"
        className="flex max-w-full min-w-0 flex-wrap items-end gap-2 [&>div]:max-w-full [&>div]:min-w-0"
      >
        <Selector etiqueta="Periodo" name="periodo" defaultValue={periodo.clave} opciones={OPCIONES} />
        <Campo etiqueta="Desde" name="desde" type="date" defaultValue={periodo.desde} />
        <Campo etiqueta="Hasta" name="hasta" type="date" defaultValue={periodo.hasta} />
        <button type="submit" className="boton-secundario">
          Ver
        </button>
      </form>
      {periodo.invalido && <p className="aviso-atencion">Ese rango no es válido: se muestra este mes.</p>}
      <p className="text-dato text-tinta-suave">
        Del {fechaCorta(periodo.desde)} al {fechaCorta(periodo.hasta)}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Dato
          titulo="Ventas"
          valor={formatoMXN(r.ventasCentavos)}
          detalle={`${r.notas} ${r.notas === 1 ? 'nota' : 'notas'}`}
        />
        <Dato titulo="Cobros" valor={formatoMXN(r.cobrosCentavos)} />
        <Dato
          titulo="Margen"
          valor={pct === null ? sinMargen : formatoMXN(r.margenCentavos)}
          detalle={pct === null ? undefined : `${pct.toFixed(1)} % de lo vendido con costo`}
        />
        <Dato titulo="Por cobrar hoy" valor={formatoMXN(r.porCobrarCentavos)} />
      </div>
      {r.piezasSinCosto > 0 && (
        <p className="aviso-atencion">
          {r.piezasSinCosto === 1
            ? '1 pieza vendida sin costo capturado'
            : `${r.piezasSinCosto} piezas vendidas sin costo capturado`}
          : no cuentan en el margen.
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Top titulo="Top asociados" filas={r.topVendedoras} />
        <Top titulo="Top categorías" filas={r.topCategorias} />
        <Top titulo="Top clientas" filas={r.topClientas} />
      </div>
      <section className="tarjeta flex flex-col gap-4 p-4" aria-labelledby="inventario-hoy">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="inventario-hoy" className="text-monto font-semibold">
            Inventario hoy
          </h2>
          {/* Σ precio de venta de lo que no se ha vendido (sin vendidas, regalos ni defectos). */}
          <p className="tabular-nums">
            <span className="text-destacado font-bold">{formatoMXN(r.inventario.valorCentavos)}</span>{' '}
            <span className="text-meta text-tinta-suave">
              · {r.inventario.piezas} {r.inventario.piezas === 1 ? 'pieza' : 'piezas'}
            </span>
          </p>
        </div>
        <h3 className="text-dato font-semibold">Piezas por ubicación</h3>
        {r.ubicaciones.length === 0 ? (
          <p className="text-dato text-tinta-suave">No hay piezas en inventario.</p>
        ) : (
          <ul className="grid gap-x-8 gap-y-1 text-dato sm:grid-cols-2 lg:grid-cols-3">
            {r.ubicaciones.map((u) => (
              <li key={u.etiqueta} className="flex items-baseline gap-3 py-1 tabular-nums">
                <span className="min-w-0 flex-1 truncate">{u.etiqueta}</span>
                <span className="text-tinta-suave">{u.piezas}</span>
                <span className="text-right whitespace-nowrap">{formatoMXN(u.valorCentavos)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
