import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conDbLectura } from '@/db/client';
import { montoDevolucion } from '@/domain/devolucion';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { formatoFolio, parsearFolio } from '@/domain/pedidos';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { textoLealtadGuardada } from '@/features/pedidos/texto-lealtad';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoPedido } from '@/features/ui/estado-visual';
import { Fecha } from '@/features/ui/Fecha';
import { EncabezadoAcciones } from '@/features/ui/MenuAcciones';
import { Saldo } from '@/features/ui/Saldo';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { exhibidorCobradorDelPedido } from '@/server/exhibidores/lecturas-dinero';
import { obtenerPedidoPorFolio } from '@/server/pedidos/lecturas';
import { saldoFavorDeCliente } from '@/server/saldo-favor/servicio';
import { ETIQUETA_METODO_REGISTRADO, fechaCorta } from '../etiquetas';
import { FormDevolver } from './FormDevolver';
import { FormCancelarPedido, FormRegistrarPago } from './FormsPedido';

type Params = Promise<{ folio: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const folio = parsearFolio((await params).folio);
  return { title: folio === null ? 'Pedido' : formatoFolio(folio) };
}

const mxn = (n: string) => formatoMXN(numericACentavos(n));

export default async function FichaPedido({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const folio = parsearFolio((await params).folio);
  if (folio === null) notFound();
  const sp = await searchParams;
  const resultado = await conDbLectura(async (db) => {
    const p = await obtenerPedidoPorFolio(db, folio);
    if (!p) return null;
    const [historial, saldoFavor, exhibidor] = await Promise.all([
      historialDeCambios(db, 'pedido', p.id),
      saldoFavorDeCliente(db, p.clienteId),
      p.estado === 'abierto' ? exhibidorCobradorDelPedido(db, p.id, p.vendedorId) : null,
    ]);
    return { p, historial, saldoFavor, exhibidor };
  });
  if (!resultado) notFound();
  const { p, historial, saldoFavor, exhibidor } = resultado;
  const vigentes = p.items.filter((i) => i.vigente);
  // Una línea devuelta (Plan 3.1) deja de ser vigente pero sigue en el subtotal: no es una pieza «quitada».
  const devueltas = p.items.filter((i) => !i.vigente && i.devolucionId);
  const quitadas = p.items.filter((i) => !i.vigente && !i.devolucionId);
  // Lo que se devolvería por cada línea: el mismo cálculo que hace el servicio (todas las líneas sin quitar).
  const lineasDelPedido = p.items
    .filter((i) => i.quitadoAt === null)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((i) => ({ id: i.id, precioFinal: numericACentavos(i.precioFinal) }));
  const montoAFavor = (id: string) =>
    montoDevolucion(lineasDelPedido, numericACentavos(p.descuentoManualMonto), id);
  const abierto = p.estado === 'abierto';
  const pagadoCentavos = numericACentavos(p.pagado);
  const datosPago = {
    pedidoId: p.id,
    folio: p.folio,
    version: p.version,
    abierto,
    clienteNombre: p.clienteNombre,
    vendedorNombre: p.vendedorNombre,
    saldo: p.saldo,
    saldoTexto: mxn(p.saldo),
    pagadoTexto: mxn(p.pagado),
    hayPagado: pagadoCentavos > 0,
    piezas: p.piezas,
    hoy: hoyMX(),
    saldoFavor,
    saldoFavorTexto: mxn(saldoFavor),
    exhibidor,
  };
  return (
    <section className="flex flex-col gap-6">
      <AvisoIndiceSucio version={p.version} />
      {/* Lo frecuente (cobrar) queda a la vista; editar y cancelar se abren desde «Más acciones». */}
      <EncabezadoAcciones
        acciones={[
          {
            id: 'editar',
            etiqueta: 'Editar pedido',
            href: `/panel/pedidos/${p.folio}/editar`,
            oculta: !abierto,
          },
          {
            id: 'cancelar',
            etiqueta: 'Cancelar pedido',
            peligro: true,
            oculta: !abierto,
            contenido: <FormCancelarPedido {...datosPago} />,
          },
        ]}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{formatoFolio(p.folio)}</h1>
          <EtiquetaEstado vista={vistaEstadoPedido(p.estado)} grande />
        </div>
      </EncabezadoAcciones>
      {sp.creado === '1' && (
        <p role="status" className="aviso-exito max-w-3xl">
          Pedido creado.
        </p>
      )}
      {sp.devuelta === '1' && (
        <p role="status" className="aviso-exito max-w-3xl">
          Pieza devuelta. Lo pagado por ella quedó como saldo a favor de la clienta.
        </p>
      )}
      {sp.editado === '1' && (
        <p role="status" className="aviso-exito max-w-3xl">
          Cambios guardados.
        </p>
      )}
      {p.estado === 'cancelado' && (
        <p className="aviso-atencion max-w-3xl">
          Cancelado el {p.canceladoAt ? <Fecha fecha={p.canceladoAt} /> : '—'}: {p.cancelacionMotivo ?? '—'}
        </p>
      )}

      {/* En pantallas anchas, dos columnas; en celular una sola, con el orden de `order-*` (cobrar cerca del saldo). */}
      <div className="ficha-cols">
        {/* Columna principal: quién, qué piezas y cuánto. */}
        <div className="ficha-col">
          <dl className="order-1 grid max-w-3xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-dato">
            <dt className="font-medium">Cliente</dt>
            <dd>
              <Link href={`/panel/clientes/${p.clienteId}`} className="enlace">
                {p.clienteNombre}
              </Link>
            </dd>
            <dt className="font-medium">Vendedor</dt>
            <dd>{p.vendedorNombre}</dd>
            <dt className="font-medium">Fecha</dt>
            <dd>{fechaCorta(p.fecha)}</dd>
            <dt className="font-medium">Tarjeta</dt>
            <dd>{textoLealtadGuardada(p)}</dd>
            <dt className="font-medium">Notas</dt>
            <dd className="max-w-prose whitespace-pre-line">{p.notas || '—'}</dd>
          </dl>

          <section aria-labelledby="piezas-pedido" className="order-4 flex flex-col gap-2 lg:order-2">
            <h2 id="piezas-pedido" className="text-lg font-semibold">
              Piezas
            </h2>
            <ul className="tarjeta flex flex-col divide-y divide-borde px-4 empty:hidden">
              {vigentes.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 py-1 text-dato">
                  <Link
                    href={`/panel/inventario/${encodeURIComponent(i.codigo)}`}
                    className="enlace inline-flex min-h-11 items-center font-mono text-monto font-semibold"
                  >
                    {i.codigo}
                  </Link>
                  <span className="min-w-0 flex-1">{i.descripcion}</span>
                  <span className="text-monto font-semibold tabular-nums">
                    {i.precioFinal !== i.precioLista && (
                      <s className="mr-2 text-dato font-normal text-tinta-suave">{mxn(i.precioLista)}</s>
                    )}
                    {mxn(i.precioFinal)}
                  </span>
                  {p.estado === 'liquidado' && montoAFavor(i.id) > 0 && (
                    <div className="basis-full">
                      <FormDevolver
                        pedidoId={p.id}
                        folio={p.folio}
                        itemId={i.id}
                        codigo={i.codigo}
                        montoTexto={formatoMXN(montoAFavor(i.id))}
                        hoy={hoyMX()}
                        fechaPedido={p.fecha}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {devueltas.length > 0 && (
              <ul aria-label="Piezas devueltas" className="flex flex-col gap-1 text-meta text-tinta-suave">
                {devueltas.map((i) => (
                  <li key={i.id}>
                    <span className="font-mono">{i.codigo}</span> · {i.descripcion} · Devuelta el{' '}
                    {i.devolucionFecha ? fechaCorta(i.devolucionFecha) : '—'} —{' '}
                    {i.devolucionMonto ? mxn(i.devolucionMonto) : '—'} a saldo a favor —{' '}
                    {i.devolucionMotivo ?? '—'}
                  </li>
                ))}
              </ul>
            )}
            {vigentes.length === 0 && p.estado !== 'cancelado' && (
              <p className="text-meta text-tinta-suave">Sin piezas vigentes.</p>
            )}
            {quitadas.length > 0 && (
              <ul
                aria-label={p.estado === 'cancelado' ? 'Piezas liberadas' : 'Piezas quitadas'}
                className="flex flex-col gap-1 text-meta text-tinta-suave"
              >
                {quitadas.map((i) => (
                  <li key={i.id}>
                    <span className="font-mono">{i.codigo}</span> · {i.descripcion} ·{' '}
                    {p.estado === 'cancelado' ? 'Liberada por cancelación' : 'Quitada'}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="order-2 flex flex-col gap-2 lg:order-3">
            <dl className="tarjeta grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 p-4 text-dato tabular-nums">
              <dt>Subtotal</dt>
              <dd className="text-right">{mxn(p.subtotal)}</dd>
              <dt>Descuento de lealtad</dt>
              <dd className="text-right">−{mxn(p.descuentoLealtadMonto)}</dd>
              <dt>
                Descuento manual
                {p.descuentoManualMotivo ? (
                  <span className="block text-meta text-tinta-suave">Motivo: {p.descuentoManualMotivo}</span>
                ) : null}
              </dt>
              <dd className="text-right">−{mxn(p.descuentoManualMonto)}</dd>
              <dt className="pt-3 text-monto font-semibold">Total</dt>
              <dd className="pt-3 text-right text-monto font-semibold">{mxn(p.total)}</dd>
              <dt>Pagado</dt>
              <dd className="text-right">{mxn(p.pagado)}</dd>

              <dt className="pt-1 text-monto font-bold">Saldo</dt>
              <dd className="pt-1 text-right">
                <Saldo estado={p.estado} saldo={p.saldo} tamano="destacado" />
              </dd>
            </dl>
            {numericACentavos(p.devuelto) > 0 && (
              <p className="text-meta text-tinta-suave">
                Devuelto: {mxn(p.devuelto)} (pasó a saldo a favor).
              </p>
            )}
          </div>

          <div className="order-7 lg:order-4">
            <HistorialCambios entradas={historial} />
          </div>
        </div>

        {/* Columna lateral: cobrar, ver pagos y las acciones del pedido. */}
        <div className="ficha-col">
          <div className="order-3 lg:order-1">
            <FormRegistrarPago {...datosPago} />
          </div>

          <section aria-labelledby="pagos-pedido" className="order-5 flex flex-col gap-2 lg:order-2">
            <h2 id="pagos-pedido" className="text-lg font-semibold">
              Pagos
            </h2>
            {p.pagos.length === 0 ? (
              <p className="text-meta text-tinta-suave">Sin pagos registrados.</p>
            ) : (
              <ul className="tarjeta flex flex-col divide-y divide-borde px-4">
                {p.pagos.map((g) => (
                  <li
                    key={g.id}
                    className={`flex flex-wrap items-baseline gap-x-3 py-3 text-dato ${g.anuladaAt ? 'text-tinta-suave' : ''}`}
                  >
                    <span className={g.anuladaAt ? 'line-through' : undefined}>
                      {fechaCorta(g.fecha)} · {ETIQUETA_METODO_REGISTRADO[g.metodo]} · {g.pagadorNombre} (
                      {g.pagadorTipo}){g.nota ? ` · ${g.nota}` : ''}
                    </span>
                    <span
                      className={`ml-auto text-monto font-semibold tabular-nums ${g.anuladaAt ? 'line-through' : ''}`}
                    >
                      {mxn(g.monto)}
                    </span>
                    {g.anuladaAt && <span className="text-meta">Anulado</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
