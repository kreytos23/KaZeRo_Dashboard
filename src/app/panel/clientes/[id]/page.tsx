import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { AreaTexto, Campo, Selector } from '@/features/ui/Campo';
import { CampoMotivo } from '@/features/ui/CampoMotivo';
import { FormRetiroSaldo } from '@/features/saldo-favor/FormRetiroSaldo';
import { HistorialSaldo } from '@/features/saldo-favor/HistorialSaldo';
import { TarjetaLealtad } from '@/features/pedidos/TarjetaLealtad';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoPedido } from '@/features/ui/estado-visual';
import { FormAccion } from '@/features/ui/FormAccion';
import { Saldo } from '@/features/ui/Saldo';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { obtenerCliente } from '@/server/clientes/servicio';
import { resumenCliente } from '@/server/pedidos/lecturas';
import { movimientosSaldoFavor } from '@/server/saldo-favor/servicio';
import { listarVendedores } from '@/server/vendedores/servicio';
import { fechaCorta } from '../../pedidos/etiquetas';
import { accionEditarCliente, accionRetirarSaldoFavor } from '../acciones';

const mxn = (n: string) => formatoMXN(numericACentavos(n));

export const metadata = { title: 'Cliente' };

export default async function FichaCliente({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [c, vendedores, cambios, resumen, libro] = await conDbLectura((db) =>
    Promise.all([
      obtenerCliente(db, id.data),
      listarVendedores(db),
      historialDeCambios(db, 'cliente', id.data),
      resumenCliente(db, id.data),
      movimientosSaldoFavor(db, { clienteId: id.data, limite: 100 }),
    ]),
  );
  if (!c) notFound();
  const opciones = [
    { valor: '', texto: '— Sin vendedor habitual —' },
    ...vendedores
      .filter((v) => v.activo || v.id === c.vendedorHabitualId)
      .map((v) => ({ valor: v.id, texto: v.nombre })),
  ];
  return (
    <section className="flex flex-col gap-6">
      <AvisoIndiceSucio version={c.version} />
      <h1 className="text-2xl font-semibold">{c.nombre}</h1>
      {/* En pantallas anchas, dos columnas (pedidos y saldo | tarjeta, datos e historial); en celular, una con `order-*`. */}
      <div className="ficha-cols">
        <div className="ficha-col">
          <section aria-labelledby="pedidos-cliente" className="order-1 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="pedidos-cliente" className="text-lg font-semibold">
                Pedidos
              </h2>
              {/* Las ventas de mostrador nacen en el exhibidor (E-1). */}
              {!c.esMostrador && (
                <Link href={`/panel/pedidos/nuevo?cliente=${c.id}`} className="boton-primario">
                  Nuevo pedido
                </Link>
              )}
            </div>
            <p>
              <Link
                href={`/panel/pedidos?q=${encodeURIComponent(c.nombre)}&saldo=1`}
                className="enlace inline-flex min-h-11 items-center"
              >
                <span className="text-monto font-semibold tabular-nums">
                  Saldo pendiente: {mxn(resumen.saldoPendiente)}
                </span>
              </Link>
            </p>
            {resumen.pedidos.length === 0 ? (
              <p className="text-meta text-tinta-suave">Este cliente todavía no tiene pedidos.</p>
            ) : (
              <ul
                aria-label="Pedidos del cliente"
                className="tarjeta flex flex-col divide-y divide-borde px-4"
              >
                {resumen.pedidos.map((p) => (
                  <li
                    key={p.id}
                    className="relative flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-dato"
                  >
                    {/* Enlace extendido a toda la fila: el toque no exige apuntar al folio. */}
                    <Link
                      href={`/panel/pedidos/${p.folio}`}
                      className="enlace text-monto font-semibold after:absolute after:inset-0 after:content-['']"
                    >
                      {formatoFolio(p.folio)}
                    </Link>
                    <span className="text-meta text-tinta-suave">{fechaCorta(p.fecha)}</span>
                    <span className="ml-auto tabular-nums">Total {mxn(p.total)}</span>
                    <Saldo estado={p.estado} saldo={p.saldo} />
                    <EtiquetaEstado vista={vistaEstadoPedido(p.estado)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="saldo-favor" className="order-3 flex flex-col gap-3">
            <h2 id="saldo-favor" className="text-lg font-semibold">
              Saldo a favor
            </h2>
            <p className="tarjeta p-4 text-3xl font-semibold tabular-nums">{mxn(resumen.saldoFavor)}</p>
            <FormRetiroSaldo
              accion={accionRetirarSaldoFavor}
              campoTitular="clienteId"
              titularId={c.id}
              saldo={resumen.saldoFavor}
              saldoTexto={mxn(resumen.saldoFavor)}
              hayInicial={numericACentavos(resumen.saldoFavor) > 0}
            />
            <HistorialSaldo libro={libro} />
          </section>
        </div>
        <div className="ficha-col">
          {/* Las notas de «Venta de mostrador» no cuentan en tarjeta: su ficha no la muestra. */}
          {!c.esMostrador && (
            <div className="order-2">
              <TarjetaLealtad tarjeta={resumen.tarjeta} />
            </div>
          )}
          <div className="order-4 flex max-w-2xl flex-col gap-3">
            <FormAccion accion={accionEditarCliente} textoBoton="Guardar cambios">
              {/* key por versión en los campos (no en el formulario): refresca los defaultValue sin perder el estado de la acción. */}
              <Fragment key={c.version}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="version" value={c.version} />
                <Campo etiqueta="Nombre" name="nombre" defaultValue={c.nombre} required maxLength={120} />
                <Campo
                  etiqueta="Referencia"
                  name="referencia"
                  defaultValue={c.referencia ?? ''}
                  maxLength={120}
                />
                <Campo
                  etiqueta="Teléfono"
                  name="telefono"
                  type="tel"
                  defaultValue={c.telefono ?? ''}
                  maxLength={30}
                />
                <Campo
                  etiqueta="Cumpleaños"
                  name="cumpleanos"
                  type="date"
                  defaultValue={c.cumpleanos ?? ''}
                />
                <Campo
                  etiqueta="Red social"
                  name="redSocial"
                  defaultValue={c.redSocial ?? ''}
                  maxLength={40}
                  placeholder="IG, FB…"
                />
                <Campo
                  etiqueta="Usuario en la red"
                  name="usuarioRed"
                  defaultValue={c.usuarioRed ?? ''}
                  maxLength={80}
                />
                <Selector
                  etiqueta="Vendedor habitual"
                  name="vendedorHabitualId"
                  opciones={opciones}
                  defaultValue={c.vendedorHabitualId ?? ''}
                />
                <AreaTexto etiqueta="Notas" name="notas" defaultValue={c.notas} rows={3} maxLength={2000} />
                <CampoMotivo />
              </Fragment>
            </FormAccion>
          </div>
          <div className="order-5">
            <HistorialCambios entradas={cambios} />
          </div>
        </div>
      </div>
    </section>
  );
}
