/**
 * Esqueletos de carga (receta 14-skeleton-reveal de transitions.dev): barras que ocupan el mismo lugar que el
 * contenido real y pulsan solo si la persona no pidió «menos movimiento». Nada de spinners en medio de la página.
 */
function Barra({ className }: { className: string }) {
  return <div aria-hidden="true" className={`esqueleto ${className}`} />;
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Cargando…</span>
      {children}
    </div>
  );
}

/** Título + filtros + lista (pedidos, inventario, clientes): como la página real, para que no salte al cargar. */
export function EsqueletoLista({ filas = 6 }: { filas?: number }) {
  return (
    <Marco>
      <div className="flex items-center justify-between gap-2">
        <Barra className="h-8 w-40" />
        <Barra className="h-11 w-36" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Barra className="h-11 w-full sm:w-56" />
        <Barra className="h-11 w-full sm:w-40" />
        <Barra className="h-11 w-24" />
      </div>
      <div className="tarjeta flex flex-col divide-y divide-borde px-4">
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-4">
            <Barra className="h-6 w-24" />
            <Barra className="h-5 min-w-0 flex-1" />
            <Barra className="hidden h-7 w-24 sm:block" />
          </div>
        ))}
      </div>
    </Marco>
  );
}

/** Ficha (pedido, pieza): encabezado, datos y una tarjeta lateral. */
export function EsqueletoFicha() {
  return (
    <Marco>
      <div className="flex items-center gap-3">
        <Barra className="h-8 w-44" />
        <Barra className="h-8 w-28 rounded-full" />
      </div>
      <div className="ficha-cols">
        <div className="ficha-col">
          <div className="flex max-w-3xl flex-col gap-2">
            <Barra className="h-5 w-3/4" />
            <Barra className="h-5 w-2/3" />
            <Barra className="h-5 w-1/2" />
          </div>
          <Barra className="h-36 w-full rounded-xl" />
          <Barra className="h-28 w-full rounded-xl" />
        </div>
        <div className="ficha-col">
          <Barra className="h-60 w-full rounded-xl" />
          <Barra className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </Marco>
  );
}
