import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';
import { Campo, Selector } from '@/features/ui/Campo';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarPedidos } from '@/server/pedidos/lecturas';
import { listarVendedores } from '@/server/vendedores/servicio';
import { ETIQUETA_ESTADO_PEDIDO, fechaCorta } from './etiquetas';
import { POR_PAGINA, leerFiltrosPedidos } from './filtros';

export const metadata = { title: 'Pedidos' };

const mxn = (n: string) => formatoMXN(numericACentavos(n));

export default async function PaginaPedidos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const f = leerFiltrosPedidos(await searchParams);
  const [pedidos, vendedores] = await conDbLectura((db) =>
    Promise.all([
      listarPedidos(db, {
        q: f.q,
        estado: f.estado,
        vendedorId: f.vendedor,
        conSaldo: f.conSaldo,
        limite: POR_PAGINA,
        offset: (f.pagina - 1) * POR_PAGINA,
      }),
      listarVendedores(db),
    ]),
  );
  const conPagina = (p: number) => {
    const qs = new URLSearchParams();
    if (f.q) qs.set('q', f.q);
    if (f.estado) qs.set('estado', f.estado);
    if (f.vendedor) qs.set('vendedor', f.vendedor);
    if (f.conSaldo) qs.set('saldo', '1');
    qs.set('pagina', String(p));
    return `?${qs}`;
  };
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Pedidos</h1>
        <Link
          href="/panel/pedidos/nuevo"
          className="flex min-h-11 items-center rounded-lg bg-primario px-4 font-medium text-white hover:bg-primario-fuerte"
        >
          Nuevo pedido
        </Link>
      </div>
      <form role="search" className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Folio o cliente" name="q" type="search" defaultValue={f.q} maxLength={120} />
        <Selector
          etiqueta="Estado"
          name="estado"
          defaultValue={f.estado ?? ''}
          opciones={[
            { valor: '', texto: 'Todos' },
            ...Object.entries(ETIQUETA_ESTADO_PEDIDO).map(([valor, texto]) => ({ valor, texto })),
          ]}
        />
        <Selector
          etiqueta="Vendedor"
          name="vendedor"
          defaultValue={f.vendedor ?? ''}
          opciones={[
            { valor: '', texto: 'Todos' },
            ...vendedores.map((v) => ({ valor: v.id, texto: v.nombre })),
          ]}
        />
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="saldo" value="1" defaultChecked={f.conSaldo} /> Con saldo pendiente
        </label>
        <button className="min-h-11 rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave">
          Filtrar
        </button>
      </form>

      {pedidos.length === 0 ? (
        <p className="tarjeta p-4 text-sm text-tinta-suave">No hay pedidos con esos filtros.</p>
      ) : (
        <>
          <ul aria-label="Pedidos" className="flex flex-col gap-2 md:hidden">
            {pedidos.map((p) => (
              <li key={p.id} className="tarjeta flex flex-col gap-1 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/panel/pedidos/${p.folio}`} className="enlace font-semibold">
                    {formatoFolio(p.folio)}
                  </Link>
                  <span className="text-sm">{ETIQUETA_ESTADO_PEDIDO[p.estado]}</span>
                </div>
                <p>{p.clienteNombre}</p>
                <p className="text-sm text-tinta-suave">
                  {fechaCorta(p.fecha)} · {p.vendedorNombre}
                </p>
                <p className="text-sm">
                  Total {mxn(p.total)} · Saldo {mxn(p.saldo)}
                </p>
              </li>
            ))}
          </ul>
          <div className="tarjeta hidden overflow-x-auto px-4 md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Pedidos</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-2">
                    Folio
                  </th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Vendedor</th>
                  <th scope="col" className="text-right">
                    Total
                  </th>
                  <th scope="col" className="text-right">
                    Saldo
                  </th>
                  <th scope="col" className="pl-4">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.id} className="border-t border-borde">
                    <td className="py-2">
                      <Link href={`/panel/pedidos/${p.folio}`} className="enlace">
                        {formatoFolio(p.folio)}
                      </Link>
                    </td>
                    <td>{fechaCorta(p.fecha)}</td>
                    <td>{p.clienteNombre}</td>
                    <td>{p.vendedorNombre}</td>
                    <td className="text-right">{mxn(p.total)}</td>
                    <td className="text-right">{mxn(p.saldo)}</td>
                    <td className="pl-4">{ETIQUETA_ESTADO_PEDIDO[p.estado]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <nav aria-label="Páginas" className="flex gap-2">
        {f.pagina > 1 && (
          <Link href={conPagina(f.pagina - 1)} className="flex min-h-11 items-center px-3 enlace">
            Anterior
          </Link>
        )}
        {pedidos.length === POR_PAGINA && (
          <Link href={conPagina(f.pagina + 1)} className="flex min-h-11 items-center px-3 enlace">
            Siguiente
          </Link>
        )}
      </nav>
    </section>
  );
}
