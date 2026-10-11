import Link from 'next/link';

export const metadata = { title: 'Panel' };

export default function Panel() {
  return (
    <section className="fondo-acuarela flex flex-col gap-3 rounded-2xl border border-borde p-6 sm:p-8">
      <h1 className="text-2xl font-semibold">Panel Kazero</h1>
      <p className="text-tinta-suave">
        Usa el buscador (tecla /) para encontrar piezas, clientes y vendedores.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/panel/inventario/nueva"
          className="flex min-h-11 items-center rounded-lg bg-primario px-4 font-medium text-white hover:bg-primario-fuerte"
        >
          Nueva pieza
        </Link>
        <Link
          href="/panel/exhibidores"
          className="flex min-h-11 items-center rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave"
        >
          Exhibidores
        </Link>
      </div>
    </section>
  );
}
