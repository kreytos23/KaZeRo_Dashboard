import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conDbLectura } from '@/db/client';
import { numericACentavos } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { formatoFolio, parsearFolio } from '@/domain/pedidos';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { obtenerPedidoPorFolio } from '@/server/pedidos/lecturas';
import { listarVendedores } from '@/server/vendedores/servicio';
import { FormEditar } from './FormEditar';

type Params = Promise<{ folio: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const folio = parsearFolio((await params).folio);
  return { title: folio === null ? 'Editar pedido' : `Editar ${formatoFolio(folio)}` };
}

export default async function EditarPedido({ params }: { params: Params }) {
  await requerirSesion();
  const folio = parsearFolio((await params).folio);
  if (folio === null) notFound();
  const [p, vendedores] = await conDbLectura((db) =>
    Promise.all([obtenerPedidoPorFolio(db, folio), listarVendedores(db)]),
  );
  if (!p) notFound();
  const regreso = (
    <Link href={`/panel/pedidos/${p.folio}`} className="enlace flex min-h-11 items-center">
      Volver a {formatoFolio(p.folio)}
    </Link>
  );
  if (p.estado !== 'abierto')
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Editar {formatoFolio(p.folio)}</h1>
        <p className="aviso-atencion">Solo se edita un pedido abierto.</p>
        {regreso}
      </section>
    );
  const manual = numericACentavos(p.descuentoManualMonto) > 0 ? p.descuentoManualMonto : '';
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Editar {formatoFolio(p.folio)}</h1>
      {regreso}
      <FormEditar
        pedidoId={p.id}
        folio={p.folio}
        version={p.version}
        vendedorId={p.vendedorId}
        vendedores={vendedores
          .filter((v) => v.activo || v.id === p.vendedorId)
          .map((v) => ({ id: v.id, nombre: v.nombre }))}
        fecha={p.fecha}
        hoy={hoyMX()}
        descuentoManual={manual}
        descuentoMotivo={p.descuentoManualMotivo ?? ''}
        notas={p.notas}
        piezas={p.items
          .filter((i) => i.vigente)
          .map((i) => ({ codigo: i.codigo, descripcion: i.descripcion }))}
      />
    </section>
  );
}
