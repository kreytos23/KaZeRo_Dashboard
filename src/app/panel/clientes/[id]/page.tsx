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
import { TarjetaLealtad } from '@/features/pedidos/TarjetaLealtad';
import { FormAccion } from '@/features/ui/FormAccion';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { obtenerCliente } from '@/server/clientes/servicio';
import { resumenCliente } from '@/server/pedidos/lecturas';
import { listarVendedores } from '@/server/vendedores/servicio';
import { ETIQUETA_ESTADO_PEDIDO, fechaCorta } from '../../pedidos/etiquetas';
import { accionEditarCliente } from '../acciones';

const mxn = (n: string) => formatoMXN(numericACentavos(n));

export const metadata = { title: 'Cliente' };

export default async function FichaCliente({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [c, vendedores, cambios, resumen] = await conDbLectura((db) =>
    Promise.all([
      obtenerCliente(db, id.data),
      listarVendedores(db),
      historialDeCambios(db, 'cliente', id.data),
      resumenCliente(db, id.data),
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
    <section className="flex max-w-3xl flex-col gap-6">
      <AvisoIndiceSucio version={c.version} />
      <h1 className="text-2xl font-semibold">{c.nombre}</h1>
      <FormAccion accion={accionEditarCliente} textoBoton="Guardar cambios">
        {/* key por versión en los campos (no en el formulario): refresca los defaultValue sin perder el estado de la acción. */}
        <Fragment key={c.version}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="version" value={c.version} />
          <Campo etiqueta="Nombre" name="nombre" defaultValue={c.nombre} required maxLength={120} />
          <Campo etiqueta="Referencia" name="referencia" defaultValue={c.referencia ?? ''} maxLength={120} />
          <Campo
            etiqueta="Teléfono"
            name="telefono"
            type="tel"
            defaultValue={c.telefono ?? ''}
            maxLength={30}
          />
          <Campo etiqueta="Cumpleaños" name="cumpleanos" type="date" defaultValue={c.cumpleanos ?? ''} />
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
      <section aria-labelledby="pedidos-cliente" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pedidos-cliente" className="text-lg font-semibold">
            Pedidos
          </h2>
          <Link
            href={`/panel/pedidos/nuevo?cliente=${c.id}`}
            className="flex min-h-11 items-center rounded-lg bg-primario px-4 font-medium text-white hover:bg-primario-fuerte"
          >
            Nuevo pedido
          </Link>
        </div>
        <p>
          <Link
            href={`/panel/pedidos?q=${encodeURIComponent(c.nombre)}&saldo=1`}
            className="enlace inline-flex min-h-11 items-center"
          >
            Saldo pendiente: {mxn(resumen.saldoPendiente)}
          </Link>
        </p>
        {numericACentavos(resumen.saldoFavor) > 0 && (
          <p>
            Saldo a favor: {mxn(resumen.saldoFavor)}
            <span className="block text-sm text-tinta-suave">
              Se podrá usar en un pago (módulo de pagos).
            </span>
          </p>
        )}
        {resumen.pedidos.length === 0 ? (
          <p className="text-sm text-tinta-suave">Este cliente todavía no tiene pedidos.</p>
        ) : (
          <ul aria-label="Pedidos del cliente" className="tarjeta flex flex-col divide-y divide-borde px-4">
            {resumen.pedidos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <Link href={`/panel/pedidos/${p.folio}`} className="enlace font-medium">
                  {formatoFolio(p.folio)}
                </Link>
                <span>{fechaCorta(p.fecha)}</span>
                <span>Total {mxn(p.total)}</span>
                <span>Saldo {mxn(p.saldo)}</span>
                <span className="text-tinta-suave">{ETIQUETA_ESTADO_PEDIDO[p.estado]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <TarjetaLealtad tarjeta={resumen.tarjeta} />
      <HistorialCambios entradas={cambios} />
    </section>
  );
}
