import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conDb } from '@/db/client';
import { codigoDeSegmento, tituloDeCodigo } from '@/domain/codigos';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { Campo, Selector } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { historial, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { accionCambiarEstado } from '../acciones';
import { ETIQUETA_ESTADO, ETIQUETA_MOVIMIENTO, destinosManuales } from '../etiquetas';

const FECHA = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
});

// El título sale del código de la URL (normalizado y validado): sin consulta extra a la BD.
export async function generateMetadata({ params }: { params: Promise<{ codigo: string }> }) {
  return { title: tituloDeCodigo((await params).codigo) };
}

export default async function FichaPieza({ params }: { params: Promise<{ codigo: string }> }) {
  await requerirSesion();
  const codigo = codigoDeSegmento((await params).codigo);
  if (!codigo) notFound();
  const datos = await conDb(async (db) => {
    const p = await obtenerPiezaPorCodigo(db, codigo);
    return p ? { p, movimientos: await historial(db, p.id) } : null;
  });
  if (!datos) notFound();
  const { p, movimientos } = datos;
  const destinos = destinosManuales(p.estado);
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold">{p.codigo}</h1>
        <p className="text-stone-700">{p.descripcion}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="font-medium">Estado</dt>
        <dd>{ETIQUETA_ESTADO[p.estado]}</dd>
        <dt className="font-medium">Exhibidor</dt>
        <dd>
          {p.exhibidorId ? (
            <Link href={`/panel/exhibidores/${p.exhibidorId}`} className="underline">
              {p.exhibidorNombre}
            </Link>
          ) : (
            '—'
          )}
        </dd>
        <dt className="font-medium">Categoría</dt>
        <dd>{p.categoriaNombre}</dd>
        <dt className="font-medium">Material</dt>
        <dd>{p.materialNombre ?? '—'}</dd>
        <dt className="font-medium">Proveedor</dt>
        <dd>{p.proveedorNombre ?? '—'}</dd>
        <dt className="font-medium">Precio</dt>
        <dd>{formatoMXN(numericACentavos(p.precio))}</dd>
        <dt className="font-medium">Costo</dt>
        <dd>{formatoMXN(numericACentavos(p.costo))}</dd>
        <dt className="font-medium">Alta</dt>
        <dd>{p.fechaAlta}</dd>
      </dl>
      {destinos.length > 0 && (
        <FormAccion
          accion={accionCambiarEstado}
          textoBoton="Cambiar estado"
          className="flex flex-wrap items-end gap-2"
        >
          {/* key por versión en los campos (no en el formulario): refresca opciones y valores sin perder el estado de la acción. */}
          <Fragment key={p.version}>
            <input type="hidden" name="piezaId" value={p.id} />
            <input type="hidden" name="version" value={p.version} />
            <Selector
              etiqueta="Nuevo estado"
              name="aEstado"
              required
              opciones={destinos.map((d) => ({ valor: d, texto: ETIQUETA_ESTADO[d] }))}
            />
            <Campo etiqueta="Nota" name="nota" maxLength={200} />
          </Fragment>
        </FormAccion>
      )}
      <h2 className="text-lg font-semibold">Historial</h2>
      <ol className="flex flex-col gap-2 text-sm">
        {movimientos.map((m) => (
          <li key={m.id} className="border-l-2 border-stone-300 pl-3">
            <span className="font-medium">{ETIQUETA_MOVIMIENTO[m.tipo] ?? m.tipo}</span>
            {' · '}
            {m.deEstado ? `${ETIQUETA_ESTADO[m.deEstado]} → ` : ''}
            {ETIQUETA_ESTADO[m.aEstado]}
            {m.exhibidorNombre && ` · ${m.exhibidorNombre}`}
            {m.nota && ` · ${m.nota}`}
            <span className="block text-stone-500">{FECHA.format(m.fecha)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
