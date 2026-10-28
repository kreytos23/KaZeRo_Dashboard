import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { formatoFolio } from '@/domain/pedidos';
import { formatoMXN, numericACentavos, porcentajeLegible } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { FormRetiroSaldo } from '@/features/saldo-favor/FormRetiroSaldo';
import { HistorialSaldo } from '@/features/saldo-favor/HistorialSaldo';
import { Campo, CampoCasilla, Selector } from '@/features/ui/Campo';
import { CampoMotivo } from '@/features/ui/CampoMotivo';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoExhibidor } from '@/features/ui/estado-visual';
import { FormAccion } from '@/features/ui/FormAccion';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import { listarExhibidores } from '@/server/exhibidores/servicio';
import { piezasDeVendedora } from '@/server/piezas/custodia';
import { pedidosAbiertosDeVendedora } from '@/server/pagos/lecturas';
import { saldoFavorDeVendedor } from '@/server/pedidos/lecturas';
import { movimientosSaldoFavor } from '@/server/saldo-favor/servicio';
import { resumenDeVendedora } from '@/server/vendedores/resumen';
import { obtenerVendedor } from '@/server/vendedores/servicio';
import { accionEditarVendedor, accionRetirarSaldoVendedora } from '../acciones';
import { TIPOS } from '../tipos';
import { ETIQUETA_ESTADO } from '../../inventario/etiquetas';
import { FormsCustodia } from './FormsCustodia';
import { FormPagoAgrupado } from './FormPagoAgrupado';
import { FormUsarSaldo } from './FormUsarSaldo';

export const metadata = { title: 'Vendedor' };

export default async function FichaVendedor({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [v, exhibidores, cambios, saldoFavor, enPoder, resumen, abiertos, libro] = await conDbLectura((db) =>
    Promise.all([
      obtenerVendedor(db, id.data),
      listarExhibidores(db, { vendedorId: id.data }),
      historialDeCambios(db, 'vendedor', id.data),
      saldoFavorDeVendedor(db, id.data),
      piezasDeVendedora(db, id.data),
      resumenDeVendedora(db, id.data),
      pedidosAbiertosDeVendedora(db, id.data),
      movimientosSaldoFavor(db, { vendedorId: id.data, limite: 100 }),
    ]),
  ).catch((e: unknown) => {
    if (e instanceof ErrorNegocio && e.codigo === 'no_encontrado') notFound();
    throw e;
  });
  if (!v) notFound();
  return (
    <section className="flex flex-col gap-6">
      <AvisoIndiceSucio version={v.version} />
      <h1 className="text-2xl font-semibold">{v.nombre}</h1>
      {/* En pantallas anchas, dos columnas (piezas y exhibidores | datos e historial); en celular, una con `order-*`. */}
      <div className="ficha-cols">
        <div className="ficha-col">
          {v.tipo !== 'casa' && (
            <section aria-labelledby="piezas-en-poder" className="order-1 flex flex-col gap-3">
              <h2 id="piezas-en-poder" className="text-lg font-semibold">
                Piezas en su poder ({enPoder.length})
              </h2>
              {enPoder.length === 0 ? (
                <p className="text-meta text-tinta-suave">{v.nombre} no tiene piezas en su poder.</p>
              ) : (
                <ul
                  aria-label="Piezas en su poder"
                  className="tarjeta flex flex-col divide-y divide-borde px-4 text-dato"
                >
                  {enPoder.map((p) => (
                    <li key={p.codigo} className="flex flex-wrap items-center gap-x-3 py-1">
                      <Link
                        href={`/panel/inventario/${encodeURIComponent(p.codigo)}`}
                        className="enlace inline-flex min-h-11 items-center font-mono text-monto font-semibold"
                      >
                        {p.codigo}
                      </Link>
                      <span className="min-w-0 flex-1">{p.descripcion}</span>
                      <span className="text-tinta-suave">
                        {ETIQUETA_ESTADO[p.estado]}
                        {p.folio !== null && (
                          <>
                            {' en '}
                            <Link href={`/panel/pedidos/${p.folio}`} className="enlace">
                              {formatoFolio(p.folio)}
                            </Link>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <FormsCustodia vendedorId={v.id} nombre={v.nombre} puedeRecibir={v.activo} />
            </section>
          )}
          <section aria-labelledby="exhibidores-vendedor" className="order-2 flex flex-col gap-2">
            <h2 id="exhibidores-vendedor" className="text-lg font-semibold">
              Exhibidores
            </h2>
            <ul className="flex flex-col gap-1 text-dato">
              {exhibidores.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={`/panel/exhibidores/${e.id}`}
                    className="enlace inline-flex min-h-11 items-center"
                  >
                    {e.nombre}
                  </Link>
                  <EtiquetaEstado vista={vistaEstadoExhibidor(e.estado)} />
                  <span className="text-meta text-tinta-suave">
                    {e.piezasActuales} {e.piezasActuales === 1 ? 'pieza' : 'piezas'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="ficha-col">
          <section aria-labelledby="cobranza" className="order-2 flex flex-col gap-2">
            <h2 id="cobranza" className="text-lg font-semibold">
              Cobranza y comisiones
            </h2>
            <div className="tarjeta flex flex-col gap-1 p-4 text-dato">
              <Link
                href={`/panel/reportes/deudores?vendedor=${v.id}`}
                className="enlace inline-flex min-h-11 items-center"
              >
                Por cobrar: {formatoMXN(resumen.porCobrarCentavos)} en {resumen.pedidosConSaldo}{' '}
                {resumen.pedidosConSaldo === 1 ? 'pedido' : 'pedidos'}
              </Link>
              <Link
                href={`/panel/reportes/comisiones?mes=${resumen.comisionEnCurso.mes.slice(0, 7)}&vendedor=${v.id}`}
                className="enlace inline-flex min-h-11 items-center"
              >
                Comisión estimada de {resumen.comisionEnCurso.nombre}:{' '}
                {formatoMXN(resumen.comisionEnCurso.montoCentavos)}
              </Link>
              {resumen.pendientes.length > 0 && (
                <div className="flex flex-col">
                  <p className="font-medium">Pagos de comisión pendientes</p>
                  {resumen.pendientes.map((p) => (
                    <Link
                      key={p.mes}
                      href={`/panel/reportes/comisiones?mes=${p.mes.slice(0, 7)}&vendedor=${v.id}`}
                      className="enlace inline-flex min-h-11 items-center"
                    >
                      {p.nombre}: {formatoMXN(p.montoCentavos)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
          <section aria-labelledby="pago-agrupado" className="order-3 flex max-w-2xl flex-col gap-3">
            <h2 id="pago-agrupado" className="text-lg font-semibold">
              Registrar pago agrupado
            </h2>
            <FormPagoAgrupado vendedorId={v.id} nombre={v.nombre} pedidos={abiertos} hoy={hoyMX()} />
          </section>
          <section aria-labelledby="saldo-favor" className="order-4 flex max-w-2xl flex-col gap-3">
            <h2 id="saldo-favor" className="text-lg font-semibold">
              Saldo a favor
            </h2>
            <p className="tarjeta p-4 text-3xl font-semibold tabular-nums">
              {formatoMXN(numericACentavos(saldoFavor))}
            </p>
            <FormUsarSaldo saldo={saldoFavor} pedidos={abiertos} hoy={hoyMX()} />
            <FormRetiroSaldo
              accion={accionRetirarSaldoVendedora}
              campoTitular="vendedorId"
              titularId={v.id}
              saldo={saldoFavor}
              saldoTexto={formatoMXN(numericACentavos(saldoFavor))}
              hayInicial={numericACentavos(saldoFavor) > 0}
            />
            <HistorialSaldo libro={libro} />
          </section>
          <div className="order-5 flex max-w-2xl flex-col gap-3">
            <FormAccion accion={accionEditarVendedor} textoBoton="Guardar cambios">
              {/* key por versión en los campos (no en el formulario): refresca los defaultValue sin perder el estado de la acción. */}
              <Fragment key={v.version}>
                <input type="hidden" name="id" value={v.id} />
                <input type="hidden" name="version" value={v.version} />
                <Campo etiqueta="Nombre" name="nombre" defaultValue={v.nombre} required maxLength={80} />
                <Selector etiqueta="Tipo" name="tipo" opciones={TIPOS} defaultValue={v.tipo} />
                <Campo
                  etiqueta="Comisión (%)"
                  name="comision"
                  inputMode="decimal"
                  defaultValue={porcentajeLegible(v.comisionPct)}
                  required
                />
                <CampoCasilla name="activo" defaultChecked={v.activo}>
                  Activo
                </CampoCasilla>
                <CampoMotivo montos={[{ name: 'comision', tipo: 'porcentaje' }]} />
              </Fragment>
            </FormAccion>
          </div>
          <div className="order-6">
            <HistorialCambios entradas={cambios} />
          </div>
        </div>
      </div>
    </section>
  );
}
