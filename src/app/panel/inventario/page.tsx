import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { Campo, Selector } from '@/features/ui/Campo';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarCatalogo } from '@/server/catalogos/servicio';
import { listarPiezas } from '@/server/piezas/servicio';
import { ETIQUETA_ESTADO } from './etiquetas';
import { POR_PAGINA, leerFiltros } from './filtros';

export const metadata = { title: 'Inventario' };

export default async function PaginaInventario({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const f = leerFiltros(await searchParams);
  const [piezas, categorias] = await conDbLectura((db) =>
    Promise.all([
      listarPiezas(db, {
        q: f.q,
        estado: f.estado,
        categoriaId: f.categoria,
        limite: POR_PAGINA,
        offset: (f.pagina - 1) * POR_PAGINA,
      }),
      listarCatalogo(db, 'categoria'),
    ]),
  );
  const conPagina = (p: number) => {
    const qs = new URLSearchParams();
    if (f.q) qs.set('q', f.q);
    if (f.estado) qs.set('estado', f.estado);
    if (f.categoria) qs.set('categoria', f.categoria);
    qs.set('pagina', String(p));
    return `?${qs}`;
  };
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Inventario</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/panel/inventario/nueva"
            className="flex min-h-11 items-center rounded-lg bg-primario px-4 font-medium text-white hover:bg-primario-fuerte"
          >
            Nueva pieza
          </Link>
          <Link
            href="/panel/inventario/lote"
            className="flex min-h-11 items-center rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave"
          >
            Alta por lote
          </Link>
        </div>
      </div>
      <form role="search" className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Código o descripción" name="q" type="search" defaultValue={f.q} maxLength={120} />
        <Selector
          etiqueta="Estado"
          name="estado"
          defaultValue={f.estado ?? ''}
          opciones={[
            { valor: '', texto: 'Todos' },
            ...Object.entries(ETIQUETA_ESTADO).map(([valor, texto]) => ({ valor, texto })),
          ]}
        />
        <Selector
          etiqueta="Categoría"
          name="categoria"
          defaultValue={f.categoria ?? ''}
          opciones={[
            { valor: '', texto: 'Todas' },
            ...categorias.map((c) => ({ valor: c.id, texto: c.nombre })),
          ]}
        />
        <button className="min-h-11 rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave">
          Filtrar
        </button>
      </form>
      <div className="tarjeta overflow-x-auto px-4">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="sr-only">Piezas del inventario</caption>
          <thead>
            <tr>
              <th scope="col" className="py-2">
                Código
              </th>
              <th scope="col">Descripción</th>
              <th scope="col">Categoría</th>
              <th scope="col">Precio</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {piezas.map((p) => (
              <tr key={p.id} className="border-t border-borde">
                <td className="py-2 font-mono">
                  <Link href={`/panel/inventario/${encodeURIComponent(p.codigo)}`} className="enlace">
                    {p.codigo}
                  </Link>
                </td>
                <td>{p.descripcion}</td>
                <td>{p.categoriaNombre}</td>
                <td>{formatoMXN(numericACentavos(p.precio))}</td>
                <td>{ETIQUETA_ESTADO[p.estado]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {piezas.length === 0 && (
          <p className="py-4 text-sm text-tinta-suave">No hay piezas con esos filtros.</p>
        )}
      </div>
      <nav aria-label="Páginas" className="flex gap-2">
        {f.pagina > 1 && (
          <Link href={conPagina(f.pagina - 1)} className="flex min-h-11 items-center px-3 enlace">
            Anterior
          </Link>
        )}
        {piezas.length === POR_PAGINA && (
          <Link href={conPagina(f.pagina + 1)} className="flex min-h-11 items-center px-3 enlace">
            Siguiente
          </Link>
        )}
      </nav>
    </section>
  );
}
