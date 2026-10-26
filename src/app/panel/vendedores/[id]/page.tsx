import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { formatoFolio } from '@/domain/pedidos';
import { formatoMXN, numericACentavos, porcentajeLegible } from '@/domain/dinero';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { Campo, Selector } from '@/features/ui/Campo';
import { CampoMotivo } from '@/features/ui/CampoMotivo';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoExhibidor } from '@/features/ui/estado-visual';
import { FormAccion } from '@/features/ui/FormAccion';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarExhibidores } from '@/server/exhibidores/servicio';
import { piezasDeVendedora } from '@/server/piezas/custodia';
import { saldoFavorDeVendedor } from '@/server/pedidos/lecturas';
import { obtenerVendedor } from '@/server/vendedores/servicio';
import { accionEditarVendedor } from '../acciones';
import { TIPOS } from '../tipos';
import { ETIQUETA_ESTADO } from '../../inventario/etiquetas';
import { FormsCustodia } from './FormsCustodia';

export const metadata = { title: 'Vendedor' };

export default async function FichaVendedor({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [v, exhibidores, cambios, saldoFavor, enPoder] = await conDbLectura((db) =>
    Promise.all([
      obtenerVendedor(db, id.data),
      listarExhibidores(db, { vendedorId: id.data }),
      historialDeCambios(db, 'vendedor', id.data),
      saldoFavorDeVendedor(db, id.data),
      piezasDeVendedora(db, id.data),
    ]),
  );
  if (!v) notFound();
  return (
    <section className="flex flex-col gap-6">
      <AvisoIndiceSucio version={v.version} />
      <h1 className="text-2xl font-semibold">{v.nombre}</h1>
      {/* En pantallas anchas, dos columnas (piezas y exhibidores | datos e historial); en celular, una con `order-*`. */}
      <div className="ficha-cols">
        <div className="ficha-col">
          {numericACentavos(saldoFavor) > 0 && (
            <p className="order-1 text-monto font-semibold tabular-nums">
              Saldo a favor: {formatoMXN(numericACentavos(saldoFavor))}
            </p>
          )}
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
          <div className="order-3 flex max-w-2xl flex-col gap-3">
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
                <label className="flex min-h-11 items-center gap-2 text-meta font-medium">
                  <input type="checkbox" name="activo" defaultChecked={v.activo} className="size-5" /> Activo
                </label>
                <CampoMotivo montos={[{ name: 'comision', tipo: 'porcentaje' }]} />
              </Fragment>
            </FormAccion>
          </div>
          <div className="order-4">
            <HistorialCambios entradas={cambios} />
          </div>
        </div>
      </div>
    </section>
  );
}
