import Link from 'next/link';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { centavosANumeric, formatoMXN } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';
import { EstadoVacio } from '@/features/ui/EstadoVacio';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { Saldo } from '@/features/ui/Saldo';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { reporteDeudores } from '@/server/reportes/deudores';
import { listarVendedores } from '@/server/vendedores/servicio';
import { fechaCorta } from '../../pedidos/etiquetas';
import { FiltroVendedora } from './FiltroVendedora';

export const metadata = { title: 'Deudores' };

const FECHA_LARGA = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'UTC' });

export default async function Deudores({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const v = z.uuid().safeParse((await searchParams).vendedor);
  const vendedorId = v.success ? v.data : '';
  const [r, vendedores] = await conDbLectura((db) =>
    Promise.all([reporteDeudores(db, { vendedorId: vendedorId || undefined }), listarVendedores(db)]),
  );
  const pdf = `/panel/reportes/deudores/pdf${vendedorId ? `?vendedor=${vendedorId}` : ''}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <p className="text-dato text-tinta-suave">{FECHA_LARGA.format(new Date(`${r.fecha}T00:00:00Z`))}</p>
          <p className="text-destacado font-bold tabular-nums">Por cobrar: {formatoMXN(r.totalCentavos)}</p>
          <p className="text-dato text-tinta-suave">
            {r.numPedidos} {r.numPedidos === 1 ? 'pedido con saldo' : 'pedidos con saldo'}
          </p>
        </div>
        <a href={pdf} download className="boton-secundario">
          Descargar PDF
        </a>
      </div>
      <FiltroVendedora vendedores={vendedores} actual={vendedorId} />
      {r.grupos.length === 0 ? (
        <EstadoVacio titulo="Nadie debe nada." detalle="Todas las notas están al corriente." />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {r.grupos.map((g) => (
            <details key={g.vendedorId} open className="tarjeta">
              <summary className="flex min-h-14 cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <span className="text-lg font-semibold">{g.vendedorNombre}</span>
                <span className="text-monto font-semibold tabular-nums">
                  {formatoMXN(g.saldoCentavos)}
                  <span className="text-meta font-normal text-tinta-suave">
                    {' · '}
                    {g.pedidos.length} {g.pedidos.length === 1 ? 'pedido' : 'pedidos'}
                  </span>
                </span>
              </summary>
              <ul className="flex flex-col divide-y divide-borde border-t border-borde px-4">
                {g.pedidos.map((p) => (
                  <li key={p.pedidoId} className="flex flex-col gap-1 py-3 text-dato">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={`/panel/pedidos/${p.folio}`}
                        className="enlace inline-flex min-h-11 items-center text-monto font-semibold"
                      >
                        {formatoFolio(p.folio)}
                      </Link>
                      <span className="min-w-0 flex-1 font-medium">{p.clienteNombre}</span>
                      {p.atrasado ? (
                        <EtiquetaEstado vista={{ texto: '', tono: 'aviso', icono: 'abierto' }}>
                          Atrasado · {p.dias} días
                        </EtiquetaEstado>
                      ) : (
                        <span className="text-meta text-tinta-suave">{p.dias} días</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 text-meta text-tinta-suave">
                      <span>{fechaCorta(p.fecha)}</span>
                      {p.telefono && (
                        <a
                          href={`tel:${p.telefono.replace(/[^\d+]/g, '')}`}
                          className="enlace inline-flex min-h-11 items-center"
                        >
                          {p.telefono}
                        </a>
                      )}
                    </div>
                    <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 tabular-nums">
                      <div className="flex gap-1.5">
                        <dt className="text-tinta-suave">Total</dt>
                        <dd>{formatoMXN(p.totalCentavos)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-tinta-suave">Abonado</dt>
                        <dd>{formatoMXN(p.pagadoCentavos)}</dd>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="text-tinta-suave">Saldo</dt>
                        <dd>
                          <Saldo estado="abierto" saldo={centavosANumeric(p.saldoCentavos)} />
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
