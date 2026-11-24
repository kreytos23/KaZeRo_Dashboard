'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useRef, useTransition, type FormEvent, type ReactNode } from 'react';
import { consultaDeFiltros, fechasListas, urlDeFiltros } from './filtros-form';
import { useHidratado } from './hidratado';

/**
 * Formulario GET de filtros de un reporte que se aplica solo al cambiar cualquier control (sin pulsar «Ver»).
 *  - Sin JavaScript es un `<form method="get">` normal: el botón del servidor envía los campos.
 *  - Al hidratar, el botón se oculta (sigue siendo el botón por omisión de Enter) y cada cambio navega con
 *    `router.replace` dentro de una transición, sin subir el scroll ni mover el foco.
 * El select de escritorio (Radix) avisa con un `change` burbujeante solo cuando la persona elige una opción; las
 * fechas se esperan a que estén completas (o vacías).
 */
export function FormFiltros({
  children,
  className,
  textoBoton = 'Ver',
}: {
  children: ReactNode;
  className?: string;
  textoBoton?: string;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const hidratado = useHidratado();
  const [pendiente, iniciar] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);

  function navegar(siempre: boolean) {
    const form = formulario.current;
    if (!form) return;
    const consulta = consultaDeFiltros(new FormData(form));
    if (!siempre) {
      // Fecha nativa (celular): `badInput` si está a medias. Escritorio: el campo oculto lo marca con data-fecha.
      const fechas = [
        ...form.querySelectorAll<HTMLInputElement>('input[type="date"], input[data-fecha]'),
      ].map((el) => ({
        valor: el.value,
        aMedias: el.type === 'date' ? el.validity.badInput : el.dataset.fecha === 'a-medias',
      }));
      if (!fechasListas(fechas)) return;
      if (consulta === consultaDeFiltros(new URLSearchParams(window.location.search))) return;
    }
    iniciar(() => router.replace(urlDeFiltros(ruta, consulta), { scroll: false }));
  }

  // Se lee en el turno siguiente: los campos ocultos (select y fecha de escritorio) se actualizan al re-pintar.
  const alCambiar = () => setTimeout(() => navegar(false), 0);
  const alEnviar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    navegar(true);
  };

  return (
    <form
      ref={formulario}
      role="search"
      method="get"
      className={className}
      onChange={alCambiar}
      onSubmit={alEnviar}
      aria-busy={pendiente || undefined}
      data-hidratado={hidratado ? 'si' : 'no'}
    >
      {children}
      <button type="submit" className="boton-secundario" hidden={hidratado}>
        {textoBoton}
      </button>
      {pendiente && (
        <span aria-hidden="true" className="self-center text-meta text-tinta-suave">
          Actualizando…
        </span>
      )}
    </form>
  );
}
