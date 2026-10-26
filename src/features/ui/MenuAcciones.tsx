'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronGiro } from './Desplegable';

export interface AccionMenu {
  id: string;
  etiqueta: string;
  /** Acción destructiva: se pinta en color de error. */
  peligro?: boolean;
  /** Navega a otra página (p. ej. «Editar pedido»). */
  href?: string;
  /** Formulario o contenido que se abre en línea, bajo el encabezado. */
  contenido?: ReactNode;
  /**
   * No aparece en el menú (la acción ya no aplica), pero si su panel está abierto se queda hasta que se cierre:
   * así el aviso «Pedido cancelado.» no desaparece con el formulario.
   */
  oculta?: boolean;
}

/**
 * Encabezado de una ficha con un menú «Más acciones» (dropdown con la receta 05-menu-dropdown de transitions.dev)
 * y, debajo, los paneles en línea de las acciones secundarias o destructivas, que se abren a demanda con el
 * movimiento de acordeón (21-accordion). Lo frecuente (registrar un pago) queda fuera, siempre visible.
 * Teclado: el menú se abre con Enter/Espacio/↓, el panel recibe el foco al abrirse y «Cerrar» devuelve el foco al botón.
 */
export function EncabezadoAcciones({
  children,
  acciones,
  etiquetaMenu = 'Más acciones',
}: {
  children: ReactNode;
  acciones: readonly AccionMenu[];
  etiquetaMenu?: string;
}) {
  const base = useId();
  const [activo, setActivo] = useState<string | null>(null);
  const disparador = useRef<HTMLButtonElement>(null);
  // Qué panel debe recibir el foco cuando el menú termine de cerrarse (Radix devuelve el foco al botón).
  const enfocarAlCerrar = useRef<string | null>(null);

  const visibles = acciones.filter((a) => !a.oculta);
  const paneles = acciones.filter((a) => a.contenido !== undefined && (!a.oculta || a.id === activo));
  const idPanel = (id: string) => `${base}-panel-${id}`;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">{children}</div>
        {visibles.length > 0 && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <button ref={disparador} type="button" className="boton-secundario">
                {etiquetaMenu}
                <ChevronGiro />
              </button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                align="end"
                sideOffset={6}
                collisionPadding={12}
                className="menu-flotante"
                onCloseAutoFocus={(e) => {
                  const id = enfocarAlCerrar.current;
                  if (!id) return;
                  enfocarAlCerrar.current = null;
                  e.preventDefault();
                  document.getElementById(idPanel(id))?.focus();
                }}
              >
                {visibles.map((a) =>
                  a.href ? (
                    <Menu.Item key={a.id} asChild>
                      <Link href={a.href} className="opcion-menu">
                        {a.etiqueta}
                      </Link>
                    </Menu.Item>
                  ) : (
                    <Menu.Item
                      key={a.id}
                      className="opcion-menu"
                      data-peligro={a.peligro ? '' : undefined}
                      onSelect={() => {
                        enfocarAlCerrar.current = a.id;
                        setActivo(a.id);
                      }}
                    >
                      {a.etiqueta}
                    </Menu.Item>
                  ),
                )}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>
      {paneles.map((a) => {
        const abierto = activo === a.id;
        return (
          <div key={a.id} className="panel-colapsable" data-abierto={abierto}>
            <div className="interior" inert={!abierto}>
              <div className="p-1 pt-4">
                <section
                  id={idPanel(a.id)}
                  tabIndex={-1}
                  aria-labelledby={`${idPanel(a.id)}-titulo`}
                  className="tarjeta flex max-w-2xl flex-col gap-3 p-4 outline-none"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 id={`${idPanel(a.id)}-titulo`} className="text-lg font-semibold">
                      {a.etiqueta}
                    </h2>
                    <button
                      type="button"
                      aria-label="Cerrar panel"
                      className="boton-texto -me-2"
                      onClick={() => {
                        setActivo(null);
                        disparador.current?.focus();
                      }}
                    >
                      Cerrar
                    </button>
                  </div>
                  {a.contenido}
                </section>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
