import { requerirSesion } from '@/server/auth/sesion-actual';
import { accionCerrarSesion, accionCerrarTodas } from './acciones';

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  await requerirSesion();
  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-white px-4 py-3">
        <span className="font-semibold">Kazero</span>
        <div className="flex gap-2">
          <form action={accionCerrarSesion}>
            <button className="min-h-11 rounded-lg px-3 text-sm hover:bg-stone-100">Cerrar sesión</button>
          </form>
          <form action={accionCerrarTodas}>
            <button className="min-h-11 rounded-lg px-3 text-sm hover:bg-stone-100">
              Cerrar sesión en todos los dispositivos
            </button>
          </form>
        </div>
      </header>
      <main className="px-4 py-6">{children}</main>
    </div>
  );
}
