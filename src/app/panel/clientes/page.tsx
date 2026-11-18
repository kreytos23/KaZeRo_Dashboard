import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { acotarPagina, leerPagina } from '@/domain/paginacion';
import { Campo } from '@/features/ui/Campo';
import { EstadoVacio } from '@/features/ui/EstadoVacio';
import { Paginacion } from '@/features/ui/Paginacion';
import { FormAccion } from '@/features/ui/FormAccion';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { contarClientes, listarClientes } from '@/server/clientes/servicio';
import { accionCrearCliente } from './acciones';

export const metadata = { title: 'Clientes' };

const POR_PAGINA = 50;

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; pagina?: string | string[] }>;
}) {
  await requerirSesion();
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.slice(0, 120) ?? '';
  const solicitada = leerPagina(sp.pagina);
  const [clientes, total, pagina] = await conDbLectura(async (db) => {
    const pedir = (pag: number) =>
      listarClientes(db, { q, limite: POR_PAGINA, offset: (pag - 1) * POR_PAGINA });
    // Total y página en paralelo (mismo WHERE); si la página pedida se pasa de la última, se vuelve a pedir.
    const [n, primera] = await Promise.all([contarClientes(db, { q }), pedir(solicitada)]);
    const pag = acotarPagina(solicitada, n, POR_PAGINA);
    return [pag === solicitada ? primera : await pedir(pag), n, pag] as const;
  });
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Clientes</h1>
      <FormAccion accion={accionCrearCliente} textoBoton="Agregar cliente" limpiarAlGuardar>
        <Campo etiqueta="Nombre" name="nombre" required maxLength={120} />
        <Campo etiqueta="Referencia" name="referencia" maxLength={120} placeholder="5to norte, Voca 9…" />
      </FormAccion>
      <form className="flex gap-2" role="search">
        <Campo etiqueta="Filtrar clientes" name="q" type="search" defaultValue={q} maxLength={120} />
        <button className="boton-secundario self-end">Filtrar</button>
      </form>
      <ul className="tarjeta flex flex-col divide-y empty:hidden divide-borde px-4">
        {clientes.map((c) => (
          <li
            key={c.id}
            className="fila-enlace relative flex min-h-14 flex-wrap items-center gap-x-2 py-2 text-dato"
          >
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
      <Paginacion pagina={pagina} total={total} porPagina={POR_PAGINA} parametros={{ q }} />
      {clientes.length === 0 &&
        (q ? (
          <EstadoVacio
            titulo={`No hay clientes que coincidan con «${q}».`}
            accion={{ href: '/panel/clientes', texto: 'Quitar filtro' }}
          />
        ) : (
          <EstadoVacio
            titulo="Aún no hay clientes."
            detalle="Agrega la primera con el formulario de arriba."
          />
        ))}
    </section>
  );
}
