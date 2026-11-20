'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PESTANAS = [
  ['/panel/reportes/deudores', 'Deudores'],
  ['/panel/reportes/comisiones', 'Comisiones'],
  ['/panel/reportes/exhibidores', 'Exhibidores'],
] as const;

export default function LayoutReportes({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Reportes</h1>
      {/* En el celular las pestañas se desplazan dentro de su franja; la línea base es una sombra para que el scroll no la recorte. */}
      <nav
        aria-label="Reportes"
        className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-borde)]"
      >
        {PESTANAS.map(([href, texto]) => {
          const activa = ruta.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={activa ? 'page' : undefined}
              className={`flex min-h-11 shrink-0 items-center border-b-2 px-3 text-monto whitespace-nowrap sm:px-4 ${
                activa
                  ? 'border-primario font-semibold text-primario'
                  : 'border-transparent text-tinta-suave hover:text-tinta'
              }`}
            >
              {texto}
            </Link>
          );
        })}
      </nav>
      {children}
    </section>
  );
}
