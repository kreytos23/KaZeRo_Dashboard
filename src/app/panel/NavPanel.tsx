'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAVEGACION = [
  ['/panel/pedidos', 'Pedidos'],
  ['/panel/inventario', 'Inventario'],
  ['/panel/exhibidores', 'Exhibidores'],
  ['/panel/clientes', 'Clientes'],
  ['/panel/vendedores', 'Vendedores'],
  ['/panel/catalogos', 'Catálogos'],
  ['/panel/administradores', 'Administradores'],
] as const;

/**
 * La sección actual se marca con aria-current (lectores de pantalla) además del color y el peso.
 * `vertical` es la variante del menú del celular; `alElegir` deja que el menú se cierre al navegar.
 */
export function NavPanel({ vertical = false, alElegir }: { vertical?: boolean; alElegir?: () => void }) {
  const ruta = usePathname();
  return (
    <nav aria-label="Secciones" className={vertical ? 'flex flex-col gap-1' : '-mx-1 flex flex-wrap gap-1'}>
      {NAVEGACION.map(([href, texto]) => {
        const activa = ruta === href || ruta.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={alElegir}
            aria-current={activa ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-full px-4 text-meta transition-colors motion-reduce:transition-none ${
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
