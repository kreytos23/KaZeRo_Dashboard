import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';
import { Campo, Selector } from '@/features/ui/Campo';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoPedido } from '@/features/ui/estado-visual';
import { Saldo } from '@/features/ui/Saldo';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarClientes, obtenerCliente } from '@/server/clientes/servicio';
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
  const [pedidos, vendedores, clientes, elegido] = await conDbLectura((db) =>
    Promise.all([
      listarPedidos(db, {
        q: f.q,
        estado: f.estado,
        vendedorId: f.vendedor,
        clienteId: f.cliente,
        desde: f.desde,
        hasta: f.hasta,
        conSaldo: f.conSaldo,
        limite: POR_PAGINA,
        offset: (f.pagina - 1) * POR_PAGINA,
      }),
      listarVendedores(db),
      // Hasta 200 clientes en el selector; si el filtrado no está entre ellos se trae aparte.
      listarClientes(db, { limite: 200 }),
      f.cliente ? obtenerCliente(db, f.cliente) : Promise.resolve(null),
    ]),
  );
  const opcionesCliente = [
    { valor: '', texto: 'Todos' },
    ...(elegido && !clientes.some((c) => c.id === elegido.id) ? [elegido] : [])
      .concat(clientes)
      .map((c) => ({ valor: c.id, texto: c.nombre })),
  ];
  const rangoInvertido = Boolean(f.desde && f.hasta && f.desde > f.hasta);
  const conPagina = (p: number) => {
    const qs = new URLSearchParams();
    if (f.q) qs.set('q', f.q);
    if (f.estado) qs.set('estado', f.estado);
    if (f.vendedor) qs.set('vendedor', f.vendedor);
    if (f.cliente) qs.set('cliente', f.cliente);
    if (f.desde) qs.set('desde', f.desde);
    if (f.hasta) qs.set('hasta', f.hasta);
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
        <Selector
          etiqueta="Cliente"
          name="cliente"
          defaultValue={f.cliente ?? ''}
          opciones={opcionesCliente}
        />
        <Campo etiqueta="Desde" name="desde" type="date" defaultValue={f.desde ?? ''} />
        <Campo etiqueta="Hasta" name="hasta" type="date" defaultValue={f.hasta ?? ''} />
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="saldo" value="1" defaultChecked={f.conSaldo} /> Con saldo pendiente
        </label>
        <button className="min-h-11 rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave">
          Filtrar
        </button>
      </form>

      <p role="status" className={rangoInvertido ? 'aviso-atencion' : undefined}>
        {rangoInvertido ? 'La fecha «Desde» es posterior a «Hasta»: no habrá resultados.' : ''}
      </p>

      {pedidos.length === 0 ? (
        <p className="tarjeta p-4 text-dato text-tinta-suave">No hay pedidos con esos filtros.</p>
      ) : (
        <>
          <ul aria-label="Pedidos" className="flex flex-col gap-2 md:hidden">
            {pedidos.map((p) => (
              <li key={p.id} className="tarjeta relative flex flex-col gap-1 p-4">
                <div className="flex items-center justify-between gap-2">
                  {/* Enlace extendido a toda la tarjeta: el toque no exige apuntar al folio. */}
                  <Link
                    href={`/panel/pedidos/${p.folio}`}
                    className="enlace text-monto font-semibold after:absolute after:inset-0 after:content-['']"
                  >
                    {formatoFolio(p.folio)}
                  </Link>
                  <EtiquetaEstado vista={vistaEstadoPedido(p.estado)} />
                </div>
                <p className="text-dato">{p.clienteNombre}</p>
                <p className="text-meta text-tinta-suave">
                  {fechaCorta(p.fecha)} · {p.vendedorNombre}
                </p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p className="text-meta text-tinta-suave">
                    Total <span className="text-dato tabular-nums text-tinta">{mxn(p.total)}</span>
                  </p>
                  <p className="flex items-center gap-2 text-meta text-tinta-suave">
                    Saldo <Saldo estado={p.estado} saldo={p.saldo} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="tarjeta hidden overflow-x-auto px-2 md:block">
            <table className="w-full text-left text-dato">
              <caption className="sr-only">Pedidos</caption>
              <thead className="text-meta font-semibold text-tinta-suave">
                <tr>
                  <th scope="col" className="px-3 py-3">
                    Folio
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Fecha
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Cliente
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Vendedor
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    Total
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    Saldo
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.id} className="border-t border-borde">
                    <td className="px-3 py-2 text-monto font-semibold">
                      <Link
                        href={`/panel/pedidos/${p.folio}`}
                        className="enlace inline-flex min-h-11 items-center"
                      >
                        {formatoFolio(p.folio)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{fechaCorta(p.fecha)}</td>
                    <td className="px-3 py-2">{p.clienteNombre}</td>
                    <td className="px-3 py-2">{p.vendedorNombre}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{mxn(p.total)}</td>
                    <td className="px-3 py-2 text-right">
                      <Saldo estado={p.estado} saldo={p.saldo} />
                    </td>
                    <td className="px-3 py-2">
                      <EtiquetaEstado vista={vistaEstadoPedido(p.estado)} />
                    </td>
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
