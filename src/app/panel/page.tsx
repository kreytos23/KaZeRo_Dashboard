import Link from 'next/link';

export const metadata = { title: 'Panel' };

export default function Panel() {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">Panel Kazero</h1>
      <p className="text-stone-600">
        Usa el buscador (tecla /) para encontrar piezas, clientes y vendedores.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/panel/inventario/nueva"
          className="flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-white"
        >
          Nueva pieza
        </Link>
        <Link
          href="/panel/exhibidores"
          className="flex min-h-11 items-center rounded-lg border border-stone-300 px-4"
        >
          Exhibidores
        </Link>
      </div>
    </section>
  );
}
