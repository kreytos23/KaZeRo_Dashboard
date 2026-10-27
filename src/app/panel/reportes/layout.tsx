'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PESTANAS = [
  ['/panel/reportes/deudores', 'Deudores'],
  ['/panel/reportes/comisiones', 'Comisiones'],
] as const;

export default function LayoutReportes({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Reportes</h1>
      <nav aria-label="Reportes" className="flex gap-1 border-b border-borde">
        {PESTANAS.map(([href, texto]) => {
          const activa = ruta.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={activa ? 'page' : undefined}
              className={`-mb-px flex min-h-11 items-center border-b-2 px-4 text-monto ${
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
