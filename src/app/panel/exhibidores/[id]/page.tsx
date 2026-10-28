import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { AreaTexto, Campo, CampoCasilla } from '@/features/ui/Campo';
import { CampoMotivo } from '@/features/ui/CampoMotivo';
import { montoMovimiento, rotuloMovimiento } from '@/features/exhibidores/dinero-ui';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoExhibidor, vistaEstadoPedido } from '@/features/ui/estado-visual';
import { FormAccion } from '@/features/ui/FormAccion';
import { EncabezadoAcciones } from '@/features/ui/MenuAcciones';
import { Saldo } from '@/features/ui/Saldo';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import {
  historialDineroExhibidor,
  resumenDineroExhibidor,
  ventasDeExhibidor,
} from '@/server/exhibidores/lecturas-dinero';
import { obtenerExhibidor } from '@/server/exhibidores/servicio';
import { obtenerVendedor } from '@/server/vendedores/servicio';
import { fechaCorta } from '../../pedidos/etiquetas';
import { accionCerrar, accionEditarExhibidor, accionEnviar, accionRegresar } from '../acciones';
import { FormAbono, FormAjuste, FormEntrega, FormVenta } from './FormsDinero';

export const metadata = { title: 'Exhibidor' };

export default async function FichaExhibidor({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [e, vendedor, cambios, dinero, historial, ventas] = await conDbLectura(async (db) => {
    const ex = await obtenerExhibidor(db, id.data);
    if (!ex) return [null, null, [], null, [], []] as const;
    const [v, c, d, h, vt] = await Promise.all([
      obtenerVendedor(db, ex.vendedorId),
      historialDeCambios(db, 'exhibidor', ex.id),
      resumenDineroExhibidor(db, ex.id),
      historialDineroExhibidor(db, ex.id),
      ventasDeExhibidor(db, ex.id),
    ]);
    return [ex, v, c, d, h, vt] as const;
  });
  if (!e || !dinero) notFound();
  const abierto = e.estado === 'abierto';
  const hoy = hoyMX();
  const porEntregar = dinero.porEntregarCentavos;
  // Cambia con cada venta, cobro, entrega o ajuste: los formularios se reinician y estrenan llave de idempotencia.
  const marca = `${porEntregar}-${historial.length}-${ventas.length}-${e.piezasActuales}`;
  const notasAbiertas = ventas
    .filter((v) => v.estado === 'abierto' && v.saldoCentavos > 0)
    .map((v) => ({
      pedidoId: v.pedidoId,
      folio: v.folio,
      etiqueta: `${formatoFolio(v.folio)} · ${v.clienteNombre} · debe ${formatoMXN(v.saldoCentavos)}`,
      saldo: centavosANumeric(v.saldoCentavos),
    }));
  const formEditar = abierto ? (
    <details className="tarjeta order-10 p-4">
      <summary className="min-h-11 cursor-pointer content-center font-medium">Editar exhibidor</summary>
      <FormAccion
        accion={accionEditarExhibidor}
        textoBoton="Guardar cambios"
        className="mt-3 flex flex-col gap-3"
      >
        <Fragment key={e.version}>
          <input type="hidden" name="exhibidorId" value={e.id} />
          <input type="hidden" name="version" value={e.version} />
          <Campo etiqueta="Nombre" name="nombre" defaultValue={e.nombre} required maxLength={120} />
          <Campo
            etiqueta="Fecha de envío"
            name="fechaEnvio"
            type="date"
            defaultValue={e.fechaEnvio}
            required
          />
          <CampoMotivo />
        </Fragment>
      </FormAccion>
    </details>
  ) : (
    <p className="order-10 text-meta text-tinta-suave">
      Un exhibidor cerrado es un registro histórico: su nombre y su fecha de envío ya no se editan.
    </p>
  );
  return (
    <section className="flex flex-col gap-6">
      <AvisoIndiceSucio version={e.version} />
      <EncabezadoAcciones
        acciones={[
          {
            id: 'ajuste',
            etiqueta: 'Ajuste de dinero',
            oculta: !abierto,
            contenido: <FormAjuste exhibidorId={e.id} hoy={hoy} marca={marca} />,
          },
        ]}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{e.nombre}</h1>
          <EtiquetaEstado vista={vistaEstadoExhibidor(e.estado)} grande />
        </div>
        <p className="text-dato text-tinta-suave">
          <Link href={`/panel/vendedores/${e.vendedorId}`} className="enlace">
            {e.vendedorNombre}
          </Link>{' '}
          · {fechaCorta(e.fechaEnvio)}
        </p>
      </EncabezadoAcciones>
      {!abierto && (
        <p role="status" className="aviso-exito max-w-3xl">
          Exhibidor cerrado.
        </p>
      )}
      {abierto && vendedor && !vendedor.activo && (
        <p className="aviso-atencion max-w-3xl">
          El vendedor de este exhibidor está inactivo: no se podrán enviar piezas hasta reactivarlo.
        </p>
      )}
      <div className="ficha-cols">
        {/* Columna principal: cuánto dinero, ventas, piezas e historial. */}
        <div className="ficha-col">
          <section aria-labelledby="dinero-exhibidor" className="tarjeta order-1 flex flex-col gap-3 p-5">
            <h2 id="dinero-exhibidor" className="text-monto font-semibold">
              Por entregar
            </h2>
            {porEntregar > 0 ? (
              <Saldo
                estado="abierto"
                saldo={centavosANumeric(porEntregar)}
                tamano="destacado"
                rotulo="Por entregar"
                className="self-start"
              />
            ) : (
              <p className="text-destacado font-bold tabular-nums text-tinta-suave">{formatoMXN(0)}</p>
            )}
            <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-dato">
              <dt>Cobrado</dt>
              <dd className="text-right tabular-nums">{formatoMXN(dinero.cobradoCentavos)}</dd>
              <dt>Entregado</dt>
              <dd className="text-right tabular-nums">{formatoMXN(dinero.entregadoCentavos)}</dd>
              {dinero.ajustesCentavos !== 0 && (
                <>
                  <dt>Ajustes</dt>
                  <dd className="text-right tabular-nums">
                    {montoMovimiento('ajuste', dinero.ajustesCentavos)}
                  </dd>
                </>
              )}
            </dl>
          </section>

          <section aria-labelledby="ventas-exhibidor" className="order-5 flex flex-col gap-2">
            <h2 id="ventas-exhibidor" className="text-lg font-semibold">
              Ventas ({ventas.length})
            </h2>
            {ventas.length === 0 ? (
              <p className="text-meta text-tinta-suave">Este exhibidor todavía no tiene ventas.</p>
            ) : (
              <ul className="tarjeta flex flex-col divide-y divide-borde px-4 text-dato">
                {ventas.map((v) => (
                  <li key={v.pedidoId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <Link
                      href={`/panel/pedidos/${v.folio}`}
                      className="enlace inline-flex min-h-11 items-center font-semibold"
                    >
                      {formatoFolio(v.folio)}
                    </Link>
                    <span className={v.esMostrador ? 'italic' : undefined}>{v.clienteNombre}</span>
                    <span className="text-tinta-suave">{fechaCorta(v.fecha)}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <EtiquetaEstado vista={vistaEstadoPedido(v.estado)} />
                      <Saldo estado={v.estado} saldo={centavosANumeric(v.saldoCentavos)} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="piezas-exhibidor" className="order-7 flex flex-col gap-2">
            <h2 id="piezas-exhibidor" className="text-lg font-semibold">
              Piezas en el exhibidor ({e.piezasActuales})
            </h2>
            {e.piezas.length === 0 ? (
              <p className="text-meta text-tinta-suave">No hay piezas en este exhibidor.</p>
            ) : (
              <ul className="tarjeta flex flex-col divide-y divide-borde px-4 text-dato">
                {e.piezas.map((p) => (
                  <li key={p.id} className="py-2">
                    <Link
                      href={`/panel/inventario/${encodeURIComponent(p.codigo)}`}
                      className="enlace inline-flex min-h-11 items-center font-mono text-monto font-semibold"
                    >
                      {p.codigo}
                    </Link>{' '}
                    · {p.descripcion} · {formatoMXN(numericACentavos(p.precio))}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="apartadas-exhibidor" className="order-8 flex flex-col gap-2">
            <h2 id="apartadas-exhibidor" className="text-lg font-semibold">
              Apartadas ({e.apartadas.length})
            </h2>
            {e.apartadas.length === 0 ? (
              <p className="text-meta text-tinta-suave">No hay piezas apartadas de este exhibidor.</p>
            ) : (
              <ul className="tarjeta flex flex-col divide-y divide-borde px-4 text-dato">
                {e.apartadas.map((a) => (
                  <li key={a.codigo} className="py-2">
                    <Link
                      href={`/panel/inventario/${encodeURIComponent(a.codigo)}`}
                      className="enlace inline-flex min-h-11 items-center font-mono text-monto font-semibold"
                    >
                      {a.codigo}
                    </Link>{' '}
                    · {a.descripcion} ·{' '}
                    <Link href={`/panel/pedidos/${a.folio}`} className="enlace">
                      {formatoFolio(a.folio)}
                    </Link>{' '}
                    · {a.clienteNombre}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="historial-dinero" className="order-9 flex flex-col gap-2">
            <h2 id="historial-dinero" className="text-lg font-semibold">
              Historial de dinero
            </h2>
            {historial.length === 0 ? (
              <p className="text-meta text-tinta-suave">Aún no hay cobros ni entregas.</p>
            ) : (
              <ul className="tarjeta flex flex-col divide-y divide-borde px-4 text-dato">
                {historial.slice(0, 50).map((m, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2"
                  >
                    <span className="min-w-0">
                      {rotuloMovimiento(m)}
                      <span className="block text-meta text-tinta-suave">
                        {fechaCorta(m.fecha)} · {m.adminNombre}
                        {m.nota && m.tipo !== 'ajuste' ? ` · ${m.nota}` : ''}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {montoMovimiento(m.tipo, m.montoCentavos)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {historial.length > 50 && (
              <p className="text-meta text-tinta-suave">Se muestran los 50 movimientos más recientes.</p>
            )}
          </section>

          <div className="order-11">
            <HistorialCambios entradas={cambios} />
          </div>
        </div>

        {/* Columna lateral: lo frecuente primero (vender, entregar, abonar), luego piezas y edición. */}
        <div className="ficha-col">
          {abierto && e.piezasActuales > 0 && (
            <div className="order-2">
              <FormVenta exhibidorId={e.id} hoy={hoy} marca={marca} />
            </div>
          )}
          {abierto && porEntregar > 0 && (
            <div className="order-3">
              <FormEntrega
                exhibidorId={e.id}
                porEntregar={centavosANumeric(porEntregar)}
                hoy={hoy}
                marca={marca}
              />
            </div>
          )}
          {abierto && (
            <div className="order-4">
              <FormAbono exhibidorId={e.id} notas={notasAbiertas} hoy={hoy} marca={marca} />
            </div>
          )}
          {abierto && (
            <div className="order-6 flex flex-col gap-6">
              <FormAccion accion={accionEnviar} textoBoton="Enviar piezas" limpiarAlGuardar>
                <input type="hidden" name="exhibidorId" value={e.id} />
                <AreaTexto
                  etiqueta="Códigos a enviar"
                  name="codigos"
                  rows={4}
                  required
                  maxLength={20000}
                  placeholder="Uno por línea o separados por espacio o coma"
                />
              </FormAccion>
              <FormAccion accion={accionRegresar} textoBoton="Regresar piezas" limpiarAlGuardar>
                <input type="hidden" name="exhibidorId" value={e.id} />
                <AreaTexto etiqueta="Códigos a regresar" name="codigos" rows={4} required maxLength={20000} />
              </FormAccion>
            </div>
          )}
          {formEditar}
          {abierto && e.piezasActuales === 0 && (
            <div className="order-12">
              <FormAccion accion={accionCerrar} textoBoton="Cerrar exhibidor">
                {/* key por versión en los campos (no en el formulario): refresca sin perder el estado de la acción. */}
                <Fragment key={e.version}>
                  <input type="hidden" name="exhibidorId" value={e.id} />
                  <input type="hidden" name="version" value={e.version} />
                  <CampoCasilla name="confirmo" value="si" required>
                    Confirmo que quiero cerrar este exhibidor; no se puede reabrir.
                  </CampoCasilla>
                </Fragment>
                <p className="text-meta text-tinta-suave">
                  {porEntregar > 0
                    ? 'Primero registra la entrega del dinero que el exhibidor tiene por entregar. '
                    : ''}
                  Las piezas apartadas (listadas arriba) impiden cerrar el exhibidor: hay que resolver sus
                  pedidos primero.
                </p>
              </FormAccion>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
