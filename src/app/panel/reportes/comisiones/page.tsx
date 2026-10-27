import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { nombreMes } from '@/domain/comisiones';
import { formatoMXN, porcentajeLegible } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import { Selector } from '@/features/ui/Campo';
import { EstadoVacio } from '@/features/ui/EstadoVacio';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoPago } from '@/features/ui/estado-visual';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { mesesComisiones, reporteComisiones } from '@/server/comisiones/lecturas';
import { ErrorNegocio } from '@/server/errores';
import { listarVendedores } from '@/server/vendedores/servicio';
import { ETIQUETA_METODO, fechaCorta } from '../../pedidos/etiquetas';
import { FormCerrarMes, FormRegistrarPagoComision, PagoRegistrado } from './FormsComisiones';

export const metadata = { title: 'Comisiones' };

const MES_URL = /^\d{4}-(0[1-9]|1[0-2])$/;
const AVISOS = new Map([
  ['cerrado', 'Mes cerrado: los pedidos y montos quedaron congelados.'],
  ['pagado', 'Pago registrado.'],
  ['deshecho', 'Pago deshecho.'],
]);
const fechaMX = (iso: string) =>
  fechaCorta(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }));

export default async function Comisiones({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const sp = await searchParams;
  const v = z.uuid().safeParse(sp.vendedor);
  const vendedorId = v.success ? v.data : '';
  const hoy = hoyMX();
  const [meses, vendedores] = await conDbLectura((db) =>
    Promise.all([mesesComisiones(db, hoy), listarVendedores(db)]),
  );
  const pedido = typeof sp.mes === 'string' && MES_URL.test(sp.mes) ? sp.mes : null;
  const mes = pedido ? `${pedido}-01` : meses.abierto;
  // El reporte completo (no filtrado): el cierre y su confirmación siempre hablan de todo el mes.
  const r = await conDbLectura((db) => reporteComisiones(db, mes, { hoy })).catch((e: unknown) => {
    if (e instanceof ErrorNegocio && e.codigo === 'no_encontrado') notFound();
    throw e;
  });
  const vendedoras = vendedorId ? r.vendedoras.filter((x) => x.vendedorId === vendedorId) : r.vendedoras;
  const totalCentavos = vendedoras.reduce((s, x) => s + x.comisionCentavos, 0);
  const numPedidos = vendedoras.reduce((s, x) => s + x.pedidos, 0);
  const opcionesMes = [
    { valor: meses.abierto.slice(0, 7), texto: `${nombreMes(meses.abierto)} (en curso)` },
    ...meses.cerrados.map((c) => ({
      valor: c.mes.slice(0, 7),
      texto: `${nombreMes(c.mes)} · cerrado el ${fechaMX(c.cerradoAt)}`,
    })),
  ];
  const pdf = `/panel/reportes/comisiones/${mes.slice(0, 7)}/pdf`;
  const aviso = typeof sp.aviso === 'string' ? AVISOS.get(sp.aviso) : undefined;
  const conFiltro = vendedorId ? `?vendedor=${vendedorId}` : '';
  return (
    <div className="flex flex-col gap-6">
      {aviso && (
        <p role="status" className="aviso-exito">
          {aviso}
        </p>
      )}
      <form role="search" method="get" className="flex flex-wrap items-end gap-2">
        <Selector etiqueta="Mes" name="mes" defaultValue={mes.slice(0, 7)} opciones={opcionesMes} />
        <Selector
          etiqueta="Vendedora"
          name="vendedor"
          defaultValue={vendedorId}
          opciones={[
            { valor: '', texto: 'Todas' },
            ...vendedores.map((x) => ({ valor: x.id, texto: x.nombre })),
          ]}
        />
        <button type="submit" className="boton-secundario">
          Ver
        </button>
      </form>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-destacado font-bold tabular-nums">
            {r.nombre}: {formatoMXN(totalCentavos)}
          </h2>
          <p className="text-dato text-tinta-suave">
            {numPedidos} {numPedidos === 1 ? 'pedido' : 'pedidos'}
            {r.cerrado && r.cerradoAt ? ` · cerrado el ${fechaMX(r.cerradoAt)}` : ' · en curso'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`${pdf}${conFiltro}`} download className="boton-secundario">
            Descargar PDF
          </a>
        </div>
      </div>

      {!r.cerrado && (
        <div className="flex flex-col gap-3">
          <p className="aviso-atencion">Estimado con el % actual; se congela al cerrar.</p>
          {r.cerrable ? (
            <FormCerrarMes
              mes={mes}
              vendedor={vendedorId}
              nombre={r.nombre}
              numPedidos={r.numPedidos}
              totalTexto={formatoMXN(r.totalCentavos)}
            />
          ) : (
            <div className="flex flex-col items-start gap-2">
              <button type="button" disabled className="boton-primario">
                Cerrar {r.nombre}
              </button>
              {r.motivoNoCerrable && <p className="text-dato text-tinta-suave">{r.motivoNoCerrable}</p>}
            </div>
          )}
        </div>
      )}

      {vendedoras.length === 0 ? (
        <EstadoVacio
          titulo="Sin comisiones en este mes."
          detalle="Aparecen aquí los pedidos liquidados que entran en el mes."
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {vendedoras.map((x) => (
            <details key={x.vendedorId} open className="tarjeta">
              <summary className="flex min-h-14 cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 ps-4 pe-10">
                <span className="flex flex-col">
                  <span className="text-lg font-semibold">{x.vendedorNombre}</span>
                  <span className="text-meta text-tinta-suave">
                    {x.pct ? `${porcentajeLegible(x.pct)} %` : 'Sin %'} · {x.pedidos}{' '}
                    {x.pedidos === 1 ? 'pedido' : 'pedidos'}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  <span className="text-monto font-semibold tabular-nums">
                    {formatoMXN(x.comisionCentavos)}
                  </span>
                  <EtiquetaEstado vista={vistaEstadoPago(x.estadoPago)} />
                </span>
              </summary>
              <div className="flex flex-col gap-4 border-t border-borde px-4 py-3">
                {r.cerrado && r.corteId && x.estadoPago === 'pendiente' && (
                  <FormRegistrarPagoComision
                    mes={mes}
                    vendedor={vendedorId}
                    corteId={r.corteId}
                    vendedorId={x.vendedorId}
                    montoTexto={formatoMXN(x.comisionCentavos)}
                    hoy={hoy}
                  />
                )}
                {x.pago && (
                  <PagoRegistrado
                    mes={mes}
                    vendedor={vendedorId}
                    pagoId={x.pago.id}
                    resumen={`Pagado el ${fechaCorta(x.pago.fecha)} · ${ETIQUETA_METODO[x.pago.metodo]}${
                      x.pago.nota ? ` · ${x.pago.nota}` : ''
                    }`}
                  />
                )}
                {x.pedidosDetalle.length > 0 && (
                  <ul className="flex flex-col divide-y divide-borde">
                    {x.pedidosDetalle.map((p) => (
                      <li key={p.pedidoId} className="flex flex-col gap-0.5 py-2 text-dato">
                        <div className="flex flex-wrap items-center gap-x-3">
                          <Link
                            href={`/panel/pedidos/${p.folio}`}
                            className="enlace inline-flex min-h-11 items-center text-monto font-semibold"
                          >
                            {formatoFolio(p.folio)}
                          </Link>
                          <span className="min-w-0 flex-1 font-medium">{p.clienteNombre}</span>
                          <span className="font-semibold tabular-nums">{formatoMXN(p.montoCentavos)}</span>
                        </div>
                        <p className="text-meta text-tinta-suave tabular-nums">
                          Liquidado el {fechaCorta(p.fechaLiquidacion)} · total {formatoMXN(p.baseCentavos)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <a
                  href={`${pdf}?vendedor=${x.vendedorId}`}
                  download
                  className="enlace inline-flex min-h-11 items-center self-start text-meta"
                >
                  Descargar PDF de {x.vendedorNombre}
                </a>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
