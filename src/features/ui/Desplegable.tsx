'use client';

import { useId, useState, type ReactNode } from 'react';

export function ChevronGiro() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="chevron-giro"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 8l4.5 4.5L14.5 8" />
    </svg>
  );
}

/**
 * Panel en línea que se abre a demanda (receta «accordion» de transitions.dev): el contenido sigue montado
 * mientras está cerrado —conserva lo escrito y el aviso de «guardado»— pero oculto y fuera del orden de Tab (`inert`).
 */
export function Desplegable({
  etiqueta,
  children,
  className = '',
}: {
  etiqueta: string;
  children: ReactNode;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={`${id}-panel`}
        onClick={() => setAbierto(!abierto)}
        className="boton-texto -ms-3 text-dato text-secundario"
      >
        {etiqueta}
        <ChevronGiro />
      </button>
      <div id={`${id}-panel`} className="panel-colapsable" data-abierto={abierto}>
        <div className="interior" inert={!abierto}>
          <div className="p-1 pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
