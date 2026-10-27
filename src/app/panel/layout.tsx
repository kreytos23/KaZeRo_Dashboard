import Image from 'next/image';
import Link from 'next/link';
import { BuscadorGlobal } from '@/search/BuscadorGlobal';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { accionCerrarSesion, accionCerrarTodas } from './acciones';
import { BarraInferior } from './BarraInferior';
import { MenuMovil } from './MenuMovil';
import { NavPanel } from './NavPanel';

const BOTON_SESION =
  'min-h-11 rounded-full px-3 text-meta text-tinta-suave hover:bg-rubor-suave hover:text-tinta';
const BOTON_SESION_MOVIL =
  'min-h-11 w-full rounded-full px-4 text-left text-meta text-tinta-suave hover:bg-rubor-suave hover:text-tinta';

/** Las dos acciones de sesión: el celular las muestra dentro del menú y el escritorio en la cabecera. */
function AccionesSesion({ clase }: { clase: string }) {
  return (
    <>
      <form action={accionCerrarSesion}>
        <button className={clase}>Cerrar sesión</button>
      </form>
      <form action={accionCerrarTodas}>
        <button className={clase}>Cerrar sesión en todos los dispositivos</button>
      </form>
    </>
  );
}

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  await requerirSesion();
  return (
    <div className="min-h-dvh">
      {/* Primera parada de Tab: salta el logo, el buscador y la navegación (WCAG 2.4.1). */}
      <a
        href="#contenido"
        className="boton-primario sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:shadow-lg"
      >
        Saltar al contenido
      </a>
      <header className="relative border-b border-borde bg-superficie">
        {/* Filete con el degradado del monograma: el toque de marca sin cargar imágenes. */}
        <div
          aria-hidden="true"
          className="h-1 bg-linear-to-r from-marca-terracota via-marca-durazno to-marca-salvia"
        />
        <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-3 px-4 py-2 md:pt-3">
          {/* < md: una sola fila (logo, búsqueda, botón de menú). ≥ md: cabecera completa. */}
          <div className="flex items-center gap-3 md:flex-wrap md:justify-between md:gap-x-4 md:gap-y-2">
            <Link href="/panel" className="flex shrink-0 items-center rounded-lg">
              {/* Recurso ya optimizado (webp 2x): sin el optimizador de Next, que no aporta aquí. */}
              <Image
                src="/marca/logo-horizontal.webp"
                alt="KaZeRo"
                width={120}
                height={48}
                unoptimized
                className="h-10 w-auto md:h-12"
              />
            </Link>
            <div className="min-w-0 flex-1 md:max-w-md">
              <BuscadorGlobal />
            </div>
            <div className="hidden flex-wrap md:flex">
              <AccionesSesion clase={BOTON_SESION} />
            </div>
            <MenuMovil>
              <AccionesSesion clase={BOTON_SESION_MOVIL} />
            </MenuMovil>
          </div>
          <div className="hidden md:block">
            <NavPanel />
          </div>
        </div>
      </header>
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto w-full max-w-[90rem] px-4 py-6 outline-none sm:py-8 max-md:pb-(--alto-barra-inferior)"
      >
        {children}
      </main>
      <BarraInferior />
    </div>
  );
}
