import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conDbLectura } from '@/db/client';
import { codigoDeSegmento, tituloDeCodigo } from '@/domain/codigos';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { describirDestino, destinoCorreccion } from '@/domain/correccion';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { Campo, Selector } from '@/features/ui/Campo';
import { CampoMotivo } from '@/features/ui/CampoMotivo';
import { FormAccion } from '@/features/ui/FormAccion';
import { FECHA_HORA } from '@/features/ui/formato';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarCatalogo } from '@/server/catalogos/servicio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { historial, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { accionCambiarEstado, accionEditarPieza } from '../acciones';
import { ETIQUETA_ESTADO, ETIQUETA_MOVIMIENTO, destinosManuales } from '../etiquetas';
import { FormDeshacerCambio } from './FormDeshacerCambio';

// El título sale del código de la URL (normalizado y validado): sin consulta extra a la BD.
export async function generateMetadata({ params }: { params: Promise<{ codigo: string }> }) {
  return { title: tituloDeCodigo((await params).codigo) };
}

export default async function FichaPieza({ params }: { params: Promise<{ codigo: string }> }) {
  await requerirSesion();
  const codigo = codigoDeSegmento((await params).codigo);
  if (!codigo) notFound();
  const datos = await conDbLectura(async (db) => {
    const p = await obtenerPiezaPorCodigo(db, codigo);
    if (!p) return null;
    // Número fijo de consultas, todas contra vistas (sin N+1).
    const [movimientos, cambios, categorias] = await Promise.all([
      historial(db, p.id),
      historialDeCambios(db, 'pieza', p.id),
      listarCatalogo(db, 'categoria'),
    ]);
    return { p, movimientos, cambios, categorias };
  });
  if (!datos) notFound();
  const { p, movimientos, cambios, categorias } = datos;
  const destinos = destinosManuales(p.estado);
  const ultimo = movimientos[0];
  const destino = ultimo ? destinoCorreccion(p.estado, ultimo, ultimo.exhibidorEstado === 'abierto') : null;
  // D4: el pedido ya fijó el precio de una pieza apartada o vendida; el costo sí se corrige.
  const precioFijo = p.estado === 'apartada' || p.estado === 'vendida';
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold">{p.codigo}</h1>
        <p className="text-tinta-suave">{p.descripcion}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="font-medium">Estado</dt>
        <dd>{ETIQUETA_ESTADO[p.estado]}</dd>
        <dt className="font-medium">Exhibidor</dt>
        <dd>
          {p.exhibidorId ? (
            <Link href={`/panel/exhibidores/${p.exhibidorId}`} className="enlace">
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
      <AvisoIndiceSucio version={p.version} />
      <details className="tarjeta p-4">
        <summary className="min-h-11 cursor-pointer content-center font-medium">Editar pieza</summary>
        <FormAccion
          accion={accionEditarPieza}
          textoBoton="Guardar cambios"
          className="mt-3 flex flex-col gap-3"
        >
          {/* key por versión en los campos: refresca los defaultValue sin perder el estado de la acción. */}
          <Fragment key={p.version}>
            <input type="hidden" name="piezaId" value={p.id} />
            <input type="hidden" name="version" value={p.version} />
            <Campo
              etiqueta="Descripción"
              name="descripcion"
              defaultValue={p.descripcion}
              required
              maxLength={300}
            />
            <Campo
              etiqueta="Categoría"
              name="categoria"
              list="categorias-edicion"
              defaultValue={p.categoriaNombre}
              required
              maxLength={80}
            />
            <datalist id="categorias-edicion">
              {categorias.map((c) => (
                <option key={c.id} value={c.nombre} />
              ))}
            </datalist>
            <Campo etiqueta="Material" name="material" defaultValue={p.materialNombre ?? ''} maxLength={80} />
            <Campo
              etiqueta="Proveedor"
              name="proveedor"
              defaultValue={p.proveedorNombre ?? ''}
              maxLength={80}
            />
            <Campo etiqueta="Costo" name="costo" inputMode="decimal" defaultValue={p.costo} />
            <Campo
              etiqueta="Precio"
              name="precio"
              inputMode="decimal"
              defaultValue={p.precio}
              required
              readOnly={precioFijo}
              aria-describedby={precioFijo ? 'precio-fijo' : undefined}
            />
            {precioFijo && (
              <p id="precio-fijo" className="text-sm text-tinta-suave">
                El precio lo fijó su pedido: no se cambia mientras la pieza esté{' '}
                {ETIQUETA_ESTADO[p.estado].toLowerCase()}.
              </p>
            )}
            <CampoMotivo
              montos={[
                { name: 'costo', tipo: 'pesos' },
                { name: 'precio', tipo: 'pesos' },
              ]}
            />
          </Fragment>
        </FormAccion>
      </details>
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
      <section aria-labelledby="historial-movimientos" className="flex flex-col gap-2">
        <h2 id="historial-movimientos" className="text-lg font-semibold">
          Historial de movimientos
        </h2>
        <FormDeshacerCambio
          piezaId={p.id}
          version={p.version}
          destino={destino && ultimo ? describirDestino(destino, ultimo.exhibidorNombre) : null}
        />
        <ol className="flex flex-col gap-2 text-sm">
          {movimientos.map((m) => (
            <li key={m.id} className="border-l-2 border-marca-rubor pl-3">
              <span className="font-medium">{ETIQUETA_MOVIMIENTO[m.tipo] ?? m.tipo}</span>
              {' · '}
              {m.deEstado ? `${ETIQUETA_ESTADO[m.deEstado]} → ` : ''}
              {ETIQUETA_ESTADO[m.aEstado]}
              {m.exhibidorNombre && ` · ${m.exhibidorNombre}`}
              {m.nota && ` · ${m.nota}`}
              <span className="block text-tinta-suave">
                {FECHA_HORA.format(m.fecha)}
                {m.adminEmail && ` · ${m.adminEmail}`}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <HistorialCambios entradas={cambios} />
    </section>
  );
}
