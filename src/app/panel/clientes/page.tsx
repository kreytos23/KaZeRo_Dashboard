import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { Campo } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarClientes } from '@/server/clientes/servicio';
import { accionCrearCliente } from './acciones';

export const metadata = { title: 'Clientes' };

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requerirSesion();
  const bruto = (await searchParams).q;
  const q = (Array.isArray(bruto) ? bruto[0] : bruto)?.slice(0, 120) ?? '';
  const clientes = await conDbLectura((db) => listarClientes(db, { q, limite: 100 }));
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Clientes</h1>
      <FormAccion accion={accionCrearCliente} textoBoton="Agregar cliente" limpiarAlGuardar>
        <Campo etiqueta="Nombre" name="nombre" required maxLength={120} />
        <Campo etiqueta="Referencia" name="referencia" maxLength={120} placeholder="5to norte, Voca 9…" />
      </FormAccion>
      <form className="flex gap-2" role="search">
        <Campo etiqueta="Filtrar clientes" name="q" type="search" defaultValue={q} maxLength={120} />
        <button className="min-h-11 self-end rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave">
          Filtrar
        </button>
      </form>
      <ul className="tarjeta flex flex-col divide-y empty:hidden divide-borde px-4">
        {clientes.map((c) => (
          <li key={c.id} className="relative flex min-h-14 flex-wrap items-center gap-x-2 py-2 text-dato">
            {/* Enlace extendido a toda la fila: el toque no exige apuntar al nombre. */}
            <Link
              href={`/panel/clientes/${c.id}`}
              className="enlace text-monto font-semibold after:absolute after:inset-0 after:content-['']"
            >
              {c.nombre}
            </Link>
            {c.referencia && <span className="text-tinta-suave"> · {c.referencia}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
