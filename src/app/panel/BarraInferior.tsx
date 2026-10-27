'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { estaActiva } from './rutas';

const ICONO = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const NUEVO = '/panel/pedidos/nuevo';

/** Los cuatro accesos normales; «Nuevo pedido» va entre los dos primeros y los dos últimos. */
const ENLACES = [
  ['/panel', 'Inicio', <path key="i" d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />],
  ['/panel/pedidos', 'Pedidos', <path key="p" d="M7 4h10v16H7zM10 8h4M10 12h4M10 16h4" />],
  ['/panel/inventario', 'Inventario', <path key="v" d="M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8" />],
  ['/panel/reportes', 'Reportes', <path key="r" d="M5 20V10M12 20V4M19 20v-7" />],
] as const;

const RUTAS = [...ENLACES.map(([href]) => href), NUEVO];
const BASE = 'flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-meta';

/** Accesos rápidos fijos al pie en celular (< md). El botón central, «Nuevo pedido», es el destacado. */
export function BarraInferior() {
  const ruta = usePathname();
  const activa = (href: string) => estaActiva(ruta, href, RUTAS);
  const color = (href: string) => (activa(href) ? 'font-semibold text-primario' : 'text-tinta-suave');
  const enlace = ([href, texto, icono]: (typeof ENLACES)[number]) => (
    <li key={href}>
      <Link href={href} aria-current={activa(href) ? 'page' : undefined} className={`${BASE} ${color(href)}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px]" {...ICONO}>
          {icono}
        </svg>
        {texto}
      </Link>
    </li>
  );
  return (
    <nav
      aria-label="Accesos rápidos"
      className="fixed inset-x-0 bottom-0 z-(--z-barra) border-t border-borde bg-superficie md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-md items-end justify-around px-2 pt-1 pb-1">
        {ENLACES.slice(0, 2).map(enlace)}
        <li>
          <Link
            href={NUEVO}
            aria-label="Nuevo pedido"
            aria-current={activa(NUEVO) ? 'page' : undefined}
            className={`${BASE} ${color(NUEVO)} group focus-visible:outline-none`}
          >
            <span
              aria-hidden="true"
              className="-mt-6 flex size-14 items-center justify-center rounded-full bg-primario text-3xl leading-none text-white shadow-md group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primario"
            >
              +
            </span>
            Nuevo
          </Link>
        </li>
        {ENLACES.slice(2).map(enlace)}
      </ul>
    </nav>
  );
}
