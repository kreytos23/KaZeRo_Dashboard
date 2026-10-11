import Link from 'next/link';
import { conDb } from '@/db/client';
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
  const clientes = await conDb((db) => listarClientes(db, { q, limite: 100 }));
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Clientes</h1>
      <FormAccion accion={accionCrearCliente} textoBoton="Agregar cliente" limpiarAlGuardar>
        <Campo etiqueta="Nombre" name="nombre" required maxLength={120} />
        <Campo etiqueta="Referencia" name="referencia" maxLength={120} placeholder="5to norte, Voca 9…" />
      </FormAccion>
      <form className="flex gap-2" role="search">
        <Campo etiqueta="Filtrar clientes" name="q" type="search" defaultValue={q} maxLength={120} />
        <button className="min-h-11 self-end rounded-lg border border-stone-300 px-4">Filtrar</button>
      </form>
      <ul className="flex flex-col divide-y divide-stone-200">
        {clientes.map((c) => (
          <li key={c.id} className="py-2">
            <Link href={`/panel/clientes/${c.id}`} className="underline">
              {c.nombre}
            </Link>
            {c.referencia && <span className="text-stone-600"> · {c.referencia}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
