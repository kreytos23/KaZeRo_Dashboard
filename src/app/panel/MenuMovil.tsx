'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { NavPanel } from './NavPanel';

const MEDIA_ESCRITORIO = '(min-width: 48rem)'; // = breakpoint `md` de Tailwind
const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])';

/**
 * Menú del celular (< md): un botón en la cabecera y un panel que se despliega SOBRE el contenido
 * (posición absoluta: no empuja nada, sin salto de diseño). Mientras está abierto el foco queda
 * atrapado entre el botón y el panel y el `<main>` es inerte. `children` son las acciones de sesión.
 * El panel cerrado es display:none, así que sus enlaces no reciben foco ni salen en el árbol de accesibilidad.
 */
export function MenuMovil({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  const idPanel = useId();
  // Se guarda la ruta en la que se abrió: al cambiar de ruta deja de coincidir y el menú se cierra solo.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const abierto = abiertoEn === ruta;
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const estabaAbierto = useRef(false);

  // Foco: al abrir, al primer enlace; al cerrar, de vuelta al botón (salvo que el usuario ya lo moviera fuera).
  useEffect(() => {
    if (abierto) {
      panel.current?.querySelector<HTMLElement>(ENFOCABLES)?.focus();
    } else if (estabaAbierto.current) {
      const activo = document.activeElement;
      if (!activo || activo === document.body || panel.current?.contains(activo)) boton.current?.focus();
    }
    estabaAbierto.current = abierto;
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbiertoEn(null);
    const fuera = (e: Event) => {
      if (e.target instanceof Node && !raiz.current?.contains(e.target)) cerrar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cerrar();
      }
    };
    const ancho = window.matchMedia(MEDIA_ESCRITORIO);
    const main = document.querySelector('main');
    main?.setAttribute('inert', '');
    document.addEventListener('keydown', tecla);
    document.addEventListener('focusin', fuera);
    document.addEventListener('pointerdown', fuera);
    ancho.addEventListener('change', cerrar);
    return () => {
      main?.removeAttribute('inert');
      document.removeEventListener('keydown', tecla);
      document.removeEventListener('focusin', fuera);
      document.removeEventListener('pointerdown', fuera);
      ancho.removeEventListener('change', cerrar);
    };
  }, [abierto]);

  function atrapar(e: React.KeyboardEvent) {
    if (e.key !== 'Tab' || !abierto || !boton.current || !panel.current) return;
    const orden = [boton.current, ...panel.current.querySelectorAll<HTMLElement>(ENFOCABLES)];
    const primero = orden[0]!;
    const ultimo = orden[orden.length - 1]!;
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }

  return (
    <div ref={raiz} onKeyDown={atrapar} className="md:hidden">
      <button
        ref={boton}
        type="button"
        aria-label="Menú"
        aria-expanded={abierto}
        aria-controls={idPanel}
        onClick={() => setAbiertoEn(abierto ? null : ruta)}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-tinta hover:bg-rubor-suave"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          {abierto ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {/* Se ancla a la cabecera (relative): ocupa su ancho y queda encima del contenido. */}
      <div
        ref={panel}
        id={idPanel}
        className={`${abierto ? 'flex' : 'hidden'} absolute inset-x-0 top-full z-30 max-h-[calc(100dvh-4rem)] flex-col gap-2 overflow-y-auto border-b border-borde bg-superficie px-4 py-3 shadow-lg`}
      >
        <NavPanel vertical alElegir={() => setAbiertoEn(null)} />
        <div className="flex flex-col gap-1 border-t border-borde pt-2">{children}</div>
      </div>
    </div>
  );
}
