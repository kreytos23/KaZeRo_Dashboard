import type { ReactNode } from 'react';
import type { Icono, Tono, VistaEstado } from './estado-visual';

/**
 * Colores de texto y fondo de cada tono. Todos pasan 4.5:1 (texto oscuro de la paleta sobre su fondo suave)
 * y llevan borde del mismo color: junto con el icono, el estado no depende solo del tono.
 */
const CLASE_TONO: Record<Tono, string> = {
  exito: 'border-exito bg-exito-fondo text-exito',
  aviso: 'border-aviso-borde bg-aviso-fondo text-aviso',
  error: 'border-error bg-error-fondo text-error',
  primario: 'border-primario bg-rubor-suave text-primario-fuerte',
  secundario: 'border-secundario bg-secundario-suave text-secundario-fuerte',
  neutro: 'border-borde-campo bg-white text-tinta-suave',
};

/** Formas distintas por significado (palomita, círculo vacío, cruz, rombo, cuadro, marcador). */
function Forma({ icono }: { icono: Icono }) {
  const comun = {
    viewBox: '0 0 16 16',
    width: 16,
    height: 16,
    'aria-hidden': true,
    focusable: false,
    className: 'shrink-0',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  switch (icono) {
    case 'check':
      return (
        <svg {...comun}>
          <path d="M3 8.5l3.2 3.2L13 4.8" />
        </svg>
      );
    case 'abierto':
      return (
        <svg {...comun}>
          <circle cx="8" cy="8" r="5.2" />
        </svg>
      );
    case 'cruz':
      return (
        <svg {...comun}>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      );
    case 'rombo':
      return (
        <svg {...comun}>
          <path d="M8 2.5l5.5 5.5L8 13.5 2.5 8z" fill="currentColor" />
        </svg>
      );
    case 'cuadro':
      return (
        <svg {...comun}>
          <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.5" fill="currentColor" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...comun}>
          <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 10-9 0C3.5 9.8 8 14 8 14z" />
          <circle cx="8" cy="6.5" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

/**
 * Insignia de estado única de la app: pedido (abierto, liquidado, cancelado), pieza (estado y ubicación) y
 * exhibidor. El texto va completo y visible; el icono es solo refuerzo de forma (aria-hidden).
 */
export function EtiquetaEstado({
  vista,
  grande = false,
  className = '',
  children,
}: {
  vista: VistaEstado;
  /** Sustituye al texto cuando necesita un enlace (p. ej. «Con <vendedora>»). */
  children?: ReactNode;
  /** Fichas: letra un peldaño más grande. */
  grande?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium whitespace-nowrap ${
        grande ? 'text-monto' : 'text-meta'
      } ${CLASE_TONO[vista.tono]} ${className}`}
    >
      <Forma icono={vista.icono} />
      {children ?? vista.texto}
    </span>
  );
}
