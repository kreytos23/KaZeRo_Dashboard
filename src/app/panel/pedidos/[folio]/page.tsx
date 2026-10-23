import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { formatoFolio, parsearFolio } from '@/domain/pedidos';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { textoLealtadGuardada } from '@/features/pedidos/texto-lealtad';
import { Fecha } from '@/features/ui/Fecha';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { obtenerPedidoPorFolio } from '@/server/pedidos/lecturas';
import { ETIQUETA_ESTADO_PEDIDO, ETIQUETA_METODO_REGISTRADO, fechaCorta } from '../etiquetas';
import { FormsPedido } from './FormsPedido';

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
    return { p, historial: await historialDeCambios(db, 'pedido', p.id) };
  });
  if (!resultado) notFound();
  const { p, historial } = resultado;
  const vigentes = p.items.filter((i) => i.vigente);
  const quitadas = p.items.filter((i) => !i.vigente);
  const abierto = p.estado === 'abierto';
  const pagadoCentavos = numericACentavos(p.pagado);
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <AvisoIndiceSucio version={p.version} />
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{formatoFolio(p.folio)}</h1>
        <span className="rounded-full bg-rubor-suave px-3 py-1 text-sm font-medium">
          {ETIQUETA_ESTADO_PEDIDO[p.estado]}
        </span>
      </div>
      {sp.creado === '1' && (
        <p role="status" className="aviso-exito">
          Pedido creado.
        </p>
      )}
      {sp.editado === '1' && (
        <p role="status" className="aviso-exito">
          Cambios guardados.
        </p>
      )}
      {p.estado === 'cancelado' && (
        <p className="aviso-atencion">
          Cancelado el {p.canceladoAt ? <Fecha fecha={p.canceladoAt} /> : '—'}: {p.cancelacionMotivo ?? '—'}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
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
        <dd className="whitespace-pre-line">{p.notas || '—'}</dd>
      </dl>

      <section aria-labelledby="piezas-pedido" className="flex flex-col gap-2">
        <h2 id="piezas-pedido" className="text-lg font-semibold">
          Piezas
        </h2>
        <ul className="tarjeta flex flex-col divide-y divide-borde px-4 empty:hidden">
          {vigentes.map((i) => (
            <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
              <Link href={`/panel/inventario/${encodeURIComponent(i.codigo)}`} className="enlace font-mono">
                {i.codigo}
              </Link>
              <span className="min-w-0 flex-1">{i.descripcion}</span>
              <span>
                {i.precioFinal !== i.precioLista && (
                  <s className="mr-2 text-tinta-suave">{mxn(i.precioLista)}</s>
                )}
                {mxn(i.precioFinal)}
              </span>
            </li>
          ))}
        </ul>
        {vigentes.length === 0 && p.estado !== 'cancelado' && (
          <p className="text-sm text-tinta-suave">Sin piezas vigentes.</p>
        )}
        {quitadas.length > 0 && (
          <ul
            aria-label={p.estado === 'cancelado' ? 'Piezas liberadas' : 'Piezas quitadas'}
            className="flex flex-col gap-1 text-sm text-tinta-suave"
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

      <dl className="tarjeta grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 p-4">
        <dt>Subtotal</dt>
        <dd className="text-right">{mxn(p.subtotal)}</dd>
        <dt>Descuento de lealtad</dt>
        <dd className="text-right">−{mxn(p.descuentoLealtadMonto)}</dd>
        <dt>
          Descuento manual
          {p.descuentoManualMotivo ? (
            <span className="block text-sm text-tinta-suave">Motivo: {p.descuentoManualMotivo}</span>
          ) : null}
        </dt>
        <dd className="text-right">−{mxn(p.descuentoManualMonto)}</dd>
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">{mxn(p.total)}</dd>
        <dt>Pagado</dt>
        <dd className="text-right">{mxn(p.pagado)}</dd>
        <dt className="font-semibold">Saldo</dt>
        <dd className="text-right font-semibold">{mxn(p.saldo)}</dd>
      </dl>

      <section aria-labelledby="pagos-pedido" className="flex flex-col gap-2">
        <h2 id="pagos-pedido" className="text-lg font-semibold">
          Pagos
        </h2>
        {p.pagos.length === 0 ? (
          <p className="text-sm text-tinta-suave">Sin pagos registrados.</p>
        ) : (
          <ul className="tarjeta flex flex-col divide-y divide-borde px-4">
            {p.pagos.map((g) => (
              <li
                key={g.id}
                className={`flex flex-wrap items-baseline gap-x-3 py-2 ${g.anuladaAt ? 'text-tinta-suave' : ''}`}
              >
                <span className={g.anuladaAt ? 'line-through' : undefined}>
                  {fechaCorta(g.fecha)} · {ETIQUETA_METODO_REGISTRADO[g.metodo]} · {g.pagadorNombre} (
                  {g.pagadorTipo}){g.nota ? ` · ${g.nota}` : ''}
                </span>
                <span className={`ml-auto ${g.anuladaAt ? 'line-through' : ''}`}>{mxn(g.monto)}</span>
                {g.anuladaAt && <span className="text-sm">Anulado</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <FormsPedido
        pedidoId={p.id}
        folio={p.folio}
        version={p.version}
        abierto={abierto}
        clienteNombre={p.clienteNombre}
        vendedorNombre={p.vendedorNombre}
        saldo={p.saldo}
        saldoTexto={mxn(p.saldo)}
        pagadoTexto={mxn(p.pagado)}
        hayPagado={pagadoCentavos > 0}
        piezas={p.piezas}
        hoy={hoyMX()}
      />

      <HistorialCambios entradas={historial} />
    </section>
  );
}
