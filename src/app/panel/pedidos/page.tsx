import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { acotarPagina } from '@/domain/paginacion';
import { formatoFolio } from '@/domain/pedidos';
import { Campo, CampoCasilla, Selector } from '@/features/ui/Campo';
import { FiltrosPlegables } from '@/features/ui/FiltrosPlegables';
import { EstadoVacio } from '@/features/ui/EstadoVacio';
import { Paginacion } from '@/features/ui/Paginacion';
import { urlSinFiltro, urlSinFiltros } from '@/features/ui/filtros-url';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoPedido } from '@/features/ui/estado-visual';
import { Saldo } from '@/features/ui/Saldo';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarClientes, obtenerCliente } from '@/server/clientes/servicio';
import { contarPedidos, listarPedidos } from '@/server/pedidos/lecturas';
import { listarVendedores } from '@/server/vendedores/servicio';
import { ETIQUETA_ESTADO_PEDIDO, fechaCorta } from './etiquetas';
import { POR_PAGINA, leerFiltrosPedidos } from './filtros';

export const metadata = { title: 'Pedidos' };

const RUTA = '/panel/pedidos';
const CLAVES_FILTRO = ['q', 'estado', 'vendedor', 'cliente', 'desde', 'hasta', 'saldo'] as const;

const mxn = (n: string) => formatoMXN(numericACentavos(n));

export default async function PaginaPedidos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const f = leerFiltrosPedidos(await searchParams);
  const [pedidos, vendedores, clientes, elegido, total, pagina] = await conDbLectura(async (db) => {
    const filtros = {
      q: f.q,
      estado: f.estado,
      vendedorId: f.vendedor,
      clienteId: f.cliente,
      desde: f.desde,
      hasta: f.hasta,
      conSaldo: f.conSaldo,
    };
    const pedir = (pag: number) =>
      listarPedidos(db, { ...filtros, limite: POR_PAGINA, offset: (pag - 1) * POR_PAGINA });
    // Total y página en paralelo (mismo WHERE); si la página pedida se pasa de la última, se vuelve a pedir.
    const [n, primera, vs, cs, el] = await Promise.all([
      contarPedidos(db, filtros),
      pedir(f.pagina),
      listarVendedores(db),
      // Hasta 200 clientes en el selector; si el filtrado no está entre ellos se trae aparte.
      listarClientes(db, { limite: 200 }),
      f.cliente ? obtenerCliente(db, f.cliente) : Promise.resolve(null),
    ]);
    const pag = acotarPagina(f.pagina, n, POR_PAGINA);
    const pds = pag === f.pagina ? primera : await pedir(pag);
    return [pds, vs, cs, el, n, pag] as const;
  });
  const opcionesCliente = [
    { valor: '', texto: 'Todos' },
    ...(elegido && !clientes.some((c) => c.id === elegido.id) ? [elegido] : [])
      .concat(clientes)
      .map((c) => ({ valor: c.id, texto: c.nombre })),
  ];
  const etiquetas: [string, string | undefined][] = [
    ['q', f.q ? `“${f.q}”` : undefined],
    ['estado', f.estado && ETIQUETA_ESTADO_PEDIDO[f.estado]],
    [
      'vendedor',
      f.vendedor ? (vendedores.find((v) => v.id === f.vendedor)?.nombre ?? 'Vendedor') : undefined,
    ],
    [
      'cliente',
      f.cliente ? (opcionesCliente.find((c) => c.valor === f.cliente)?.texto ?? 'Cliente') : undefined,
    ],
    ['desde', f.desde && `Desde ${fechaCorta(f.desde)}`],
    ['hasta', f.hasta && `Hasta ${fechaCorta(f.hasta)}`],
    ['saldo', f.conSaldo ? 'Con saldo pendiente' : undefined],
  ];
  const sp = new URLSearchParams(
    Object.entries({ ...f, saldo: f.conSaldo ? '1' : undefined }).flatMap(([k, v]) =>
      v && k !== 'pagina' && k !== 'conSaldo' ? [[k, String(v)]] : [],
    ),
  );
  const activos = etiquetas.flatMap(([clave, etiqueta]) =>
    etiqueta ? [{ clave, etiqueta, href: urlSinFiltro(RUTA, sp, clave) }] : [],
  );
  const filtrado = Boolean(
    f.q || f.estado || f.vendedor || f.cliente || f.desde || f.hasta || f.conSaldo || pagina > 1,
  );
  const rangoInvertido = Boolean(f.desde && f.hasta && f.desde > f.hasta);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Pedidos</h1>
        <Link href="/panel/pedidos/nuevo" className="boton-primario">
          Nuevo pedido
        </Link>
      </div>
      <FiltrosPlegables activos={activos} hrefLimpiar={urlSinFiltros(RUTA, sp, CLAVES_FILTRO)}>
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
        <CampoCasilla name="saldo" value="1" defaultChecked={f.conSaldo}>
          Con saldo pendiente
        </CampoCasilla>
      </FiltrosPlegables>

      <p role="status" className={rangoInvertido ? 'aviso-atencion' : undefined}>
        {rangoInvertido ? 'La fecha «Desde» es posterior a «Hasta»: no habrá resultados.' : ''}
      </p>

      {pedidos.length === 0 ? (
        filtrado ? (
          <EstadoVacio
            titulo="No hay pedidos con esos filtros."
            detalle="Prueba con otros datos o quita los filtros para ver todos."
            accion={{ href: '/panel/pedidos', texto: 'Quitar filtros' }}
          />
        ) : (
          <EstadoVacio
            titulo="Aún no hay pedidos."
            detalle="Cuando captures la primera nota de pedido aparecerá aquí."
            accion={{ href: '/panel/pedidos/nuevo', texto: 'Crear pedido' }}
            principal
          />
        )
      ) : (
        <>
          <ul aria-label="Pedidos" className="flex flex-col gap-2 md:hidden">
            {pedidos.map((p) => (
              <li key={p.id} className="tarjeta tarjeta-enlace relative flex flex-col gap-1 p-4">
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
      <Paginacion
        pagina={pagina}
        total={total}
        porPagina={POR_PAGINA}
        parametros={{
          q: f.q,
          estado: f.estado,
          vendedor: f.vendedor,
          cliente: f.cliente,
          desde: f.desde,
          hasta: f.hasta,
          saldo: f.conSaldo ? '1' : undefined,
        }}
      />
    </section>
  );
}
