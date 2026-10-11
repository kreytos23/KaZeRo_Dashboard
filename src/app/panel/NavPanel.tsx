'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAVEGACION = [
  ['/panel/inventario', 'Inventario'],
  ['/panel/exhibidores', 'Exhibidores'],
  ['/panel/clientes', 'Clientes'],
  ['/panel/vendedores', 'Vendedores'],
  ['/panel/catalogos', 'Catálogos'],
  ['/panel/administradores', 'Administradores'],
] as const;

/** La sección actual se marca con aria-current (lectores de pantalla) además del color y el peso. */
export function NavPanel() {
  const ruta = usePathname();
  return (
    <nav aria-label="Secciones" className="-mx-1 flex flex-wrap gap-1">
      {NAVEGACION.map(([href, texto]) => {
        const activa = ruta === href || ruta.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={activa ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-full px-4 text-sm transition-colors motion-reduce:transition-none ${
              activa
                ? 'bg-rubor-suave font-semibold text-primario shadow-[inset_0_0_0_1px_var(--color-marca-rubor)]'
                : 'text-tinta-suave hover:bg-rubor-suave hover:text-tinta'
            }`}
          >
            {texto}
          </Link>
        );
      })}
    </nav>
  );
}
