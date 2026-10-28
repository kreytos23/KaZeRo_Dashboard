import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { fechaCorta } from '@/domain/fechas';
import { urlComprobante } from '@/domain/imagenes';
import { formatoFolio } from '@/domain/pedidos';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { Fecha } from '@/features/ui/Fecha';
import { EncabezadoAcciones } from '@/features/ui/MenuAcciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { obtenerPago } from '@/server/pagos/lecturas';
import { ETIQUETA_METODO_REGISTRADO } from '../../pedidos/etiquetas';
import { FormAgregarComprobante, FormDeshacerPago } from './FormsPago';

export const metadata: Metadata = { title: 'Pago' };

const mxn = (n: string) => formatoMXN(numericACentavos(n));

export default async function FichaPago({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const p = await conDbLectura((db) => obtenerPago(db, id.data));
  if (!p) notFound();
  const vigente = !p.anuladoAt;
  const pagador = p.clienteId
    ? { nombre: p.clienteNombre, tipo: 'cliente', href: `/panel/clientes/${p.clienteId}` }
    : { nombre: p.vendedorNombre, tipo: 'vendedor', href: `/panel/vendedores/${p.vendedorId}` };
  const folios = p.aplicaciones.map((a) => formatoFolio(a.folio)).join(', ');
  return (
    <section className="flex flex-col gap-6">
      <EncabezadoAcciones
        acciones={[
          {
            id: 'deshacer',
            etiqueta: 'Deshacer pago',
            peligro: true,
            oculta: !vigente,
            contenido: (
              <FormDeshacerPago pagoId={p.id} montoTexto={mxn(p.monto)} vigente={vigente} pedidos={folios} />
            ),
          },
        ]}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tabular-nums">Pago de {mxn(p.monto)}</h1>
          {!vigente && <EtiquetaEstado vista={{ texto: 'Anulado', tono: 'error', icono: 'cruz' }} grande />}
        </div>
      </EncabezadoAcciones>

      {!vigente && (
        <p className="aviso-atencion max-w-3xl">
          Pago deshecho el {p.anuladoAt ? <Fecha fecha={p.anuladoAt} /> : '—'}
          {p.anuladoPorEmail ? ` por ${p.anuladoPorEmail}` : ''}. Motivo: {p.anulacionMotivo ?? '—'}
        </p>
      )}

      <div className="ficha-cols">
        <div className="ficha-col">
          <dl className="order-1 grid max-w-3xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-dato">
            <dt className="font-medium">Paga</dt>
            <dd>
              <Link href={pagador.href} className="enlace">
                {pagador.nombre}
              </Link>{' '}
              ({pagador.tipo})
            </dd>
            <dt className="font-medium">Fecha</dt>
            <dd>{fechaCorta(p.fecha)}</dd>
            <dt className="font-medium">Método</dt>
            <dd>{ETIQUETA_METODO_REGISTRADO[p.metodo]}</dd>
            <dt className="font-medium">Referencia</dt>
            <dd className="break-all">{p.referencia ?? '—'}</dd>
            <dt className="font-medium">Nota</dt>
            <dd className="max-w-prose whitespace-pre-line">{p.nota || '—'}</dd>
            <dt className="font-medium">Registrado</dt>
            <dd>
              <Fecha fecha={p.createdAt} /> por {p.registradoPor}
            </dd>
          </dl>

          <section aria-labelledby="aplicaciones" className="order-3 flex flex-col gap-2 lg:order-2">
            <h2 id="aplicaciones" className="text-lg font-semibold">
              Se aplicó a
            </h2>
            {p.aplicaciones.length === 0 ? (
              <p className="text-meta text-tinta-suave">A ningún pedido: todo fue saldo a favor.</p>
            ) : (
              <ul className="tarjeta flex flex-col divide-y divide-borde px-4">
                {p.aplicaciones.map((a) => (
                  <li
                    key={a.id}
                    className={`flex flex-wrap items-baseline gap-x-3 py-1 text-dato ${vigente ? '' : 'text-tinta-suave'}`}
                  >
                    <Link
                      href={`/panel/pedidos/${a.folio}`}
                      className="enlace inline-flex min-h-11 items-center font-mono text-monto font-semibold"
                    >
                      {formatoFolio(a.folio)}
                    </Link>
                    <span className="min-w-0 flex-1">{a.clienteNombre}</span>
                    <span
                      className={`text-monto font-semibold tabular-nums ${vigente ? '' : 'line-through'}`}
                    >
                      {mxn(a.monto)}
                    </span>
                    {!vigente && <span className="text-meta">Anulado</span>}
                  </li>
                ))}
              </ul>
            )}
            {p.sobranteCentavos > 0 && (
              <p className="text-dato tabular-nums">
                {vigente
                  ? `Sobraron ${formatoMXN(p.sobranteCentavos)}: quedaron como saldo a favor de ${pagador.nombre}.`
                  : `Habían sobrado ${formatoMXN(p.sobranteCentavos)}, que se quitaron del saldo a favor.`}
              </p>
            )}
          </section>
        </div>

        <div className="ficha-col">
          <section aria-labelledby="captura" className="order-2 flex flex-col gap-3 lg:order-1">
            <h2 id="captura" className="text-lg font-semibold">
              Captura o comprobante
            </h2>
            {p.comprobanteClave ? (
              <a
                href={urlComprobante(p.id, p.comprobanteClave)}
                target="_blank"
                rel="noopener"
                className="self-start"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- captura privada servida por /api con sesión */}
                <img
                  src={urlComprobante(p.id, p.comprobanteClave)}
                  alt={`Captura del pago de ${mxn(p.monto)}. Se abre en tamaño completo en otra pestaña.`}
                  loading="lazy"
                  decoding="async"
                  className="max-h-[32rem] w-auto max-w-full rounded-lg border border-borde bg-superficie object-contain"
                />
              </a>
            ) : (
              <p className="text-meta text-tinta-suave">
                {vigente ? 'Este pago no tiene captura.' : 'Este pago no tuvo captura.'}
              </p>
            )}
            {!p.comprobanteClave && <FormAgregarComprobante pagoId={p.id} activo={vigente} />}
          </section>
        </div>
      </div>
    </section>
  );
}
