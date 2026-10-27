'use client';

import { useRef, useState, type ReactNode } from 'react';

/**
 * Filtros de un listado. Desde `md` el formulario va en línea con «Limpiar filtros»; en celular se pliegan en una
 * fila con «Filtros (n)», las etiquetas activas (cada una quita su filtro) y un panel inferior (`<dialog>` nativo:
 * foco atrapado y Esc de serie). `children` se renderiza en ambos formularios GET (el del panel solo mientras
 * está abierto, así nunca hay dos copias de los campos a la vez en celular); los controles derivan su `id` de
 * `useId`, así que no se repiten.
 */
export function FiltrosPlegables({
  activos,
  hrefLimpiar,
  children,
}: {
  activos: { clave: string; etiqueta: string; href: string }[];
  hrefLimpiar: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const [abierto, setAbierto] = useState(false);
  const hay = activos.length > 0;
  const limpiar = (
    <a href={hrefLimpiar} className="enlace inline-flex min-h-11 items-center text-meta">
      Limpiar filtros
    </a>
  );
  return (
    <>
      <form role="search" className="hidden flex-wrap items-end gap-2 md:flex">
        {children}
        <button className="boton-secundario">Filtrar</button>
        {hay && limpiar}
      </form>
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <button
          type="button"
          className="boton-secundario"
          onClick={() => {
            setAbierto(true);
            panel.current?.showModal();
          }}
        >
          Filtros ({activos.length})
        </button>
        {activos.map((a) => (
          <a key={a.clave} href={a.href} className="chip">
            {a.etiqueta} <span aria-hidden="true">✕</span>
            <span className="sr-only">quitar filtro</span>
          </a>
        ))}
      </div>
      <dialog
        ref={panel}
        onClose={() => setAbierto(false)}
        aria-labelledby="titulo-filtros"
        onClick={(e) => {
          if (e.target === panel.current) panel.current.close();
        }}
        className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl bg-superficie p-4 text-tinta backdrop:bg-tinta/35 md:hidden"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="titulo-filtros" className="text-lg font-semibold">
            Filtros
          </h2>
          <button
            type="button"
            aria-label="Cerrar filtros"
            className="boton-texto"
            onClick={() => panel.current?.close()}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {abierto && (
          <form role="search" className="flex flex-col gap-3">
            {children}
            <div className="flex flex-wrap items-center gap-2">
              <button className="boton-primario">Ver resultados</button>
              {hay && limpiar}
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
