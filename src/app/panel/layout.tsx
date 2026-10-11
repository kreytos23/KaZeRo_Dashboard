import Image from 'next/image';
import Link from 'next/link';
import { BuscadorGlobal } from '@/search/BuscadorGlobal';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { accionCerrarSesion, accionCerrarTodas } from './acciones';
import { NavPanel } from './NavPanel';

const BOTON_SESION =
  'min-h-11 rounded-full px-2 text-xs text-tinta-suave hover:bg-rubor-suave hover:text-tinta sm:px-3 sm:text-sm';

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  await requerirSesion();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-borde bg-white">
        {/* Filete con el degradado del monograma: el toque de marca sin cargar imágenes. */}
        <div
          aria-hidden="true"
          className="h-1 bg-linear-to-r from-marca-terracota via-marca-durazno to-marca-salvia"
        />
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-3 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Link href="/panel" className="flex shrink-0 items-center rounded-lg">
              {/* Recurso ya optimizado (webp 2x): sin el optimizador de Next, que no aporta aquí. */}
              <Image
                src="/marca/logo-horizontal.webp"
                alt="KaZeRo"
                width={120}
                height={48}
                unoptimized
                className="h-10 w-auto sm:h-12"
              />
            </Link>
            <div className="order-last w-full sm:order-none sm:w-auto sm:max-w-md sm:flex-1">
              <BuscadorGlobal />
            </div>
            <div className="flex flex-wrap">
              <form action={accionCerrarSesion}>
                <button className={BOTON_SESION}>Cerrar sesión</button>
              </form>
              <form action={accionCerrarTodas}>
                <button className={BOTON_SESION}>Cerrar sesión en todos los dispositivos</button>
              </form>
            </div>
          </div>
          <NavPanel />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
