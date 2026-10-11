import Link from 'next/link';
import { BuscadorGlobal } from '@/search/BuscadorGlobal';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { accionCerrarSesion, accionCerrarTodas } from './acciones';

const NAVEGACION = [
  ['/panel/inventario', 'Inventario'],
  ['/panel/exhibidores', 'Exhibidores'],
  ['/panel/clientes', 'Clientes'],
  ['/panel/vendedores', 'Vendedores'],
  ['/panel/catalogos', 'Catálogos'],
  ['/panel/administradores', 'Administradores'],
] as const;

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  await requerirSesion();
  return (
    <div className="min-h-dvh">
      <header className="flex flex-col gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/panel" className="font-semibold">
            Kazero
          </Link>
          <BuscadorGlobal />
          <div className="flex flex-wrap gap-2">
            <form action={accionCerrarSesion}>
              <button className="min-h-11 rounded-lg px-3 text-sm hover:bg-stone-100">Cerrar sesión</button>
            </form>
            <form action={accionCerrarTodas}>
              <button className="min-h-11 rounded-lg px-3 text-sm hover:bg-stone-100">
                Cerrar sesión en todos los dispositivos
              </button>
            </form>
          </div>
        </div>
        <nav aria-label="Secciones" className="flex flex-wrap gap-1">
          {NAVEGACION.map(([href, texto]) => (
            <Link
              key={href}
              href={href}
              className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-stone-100"
            >
              {texto}
            </Link>
          ))}
        </nav>
      </header>
      <main className="px-4 py-6">{children}</main>
    </div>
  );
}
