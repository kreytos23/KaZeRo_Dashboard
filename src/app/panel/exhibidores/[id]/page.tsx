import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { AreaTexto, Campo } from '@/features/ui/Campo';
import { CampoMotivo } from '@/features/ui/CampoMotivo';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoExhibidor } from '@/features/ui/estado-visual';
import { FormAccion } from '@/features/ui/FormAccion';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { obtenerExhibidor } from '@/server/exhibidores/servicio';
import { obtenerVendedor } from '@/server/vendedores/servicio';
import { accionCerrar, accionEditarExhibidor, accionEnviar, accionRegresar } from '../acciones';

export const metadata = { title: 'Exhibidor' };

export default async function FichaExhibidor({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [e, vendedor, cambios] = await conDbLectura(async (db) => {
    const ex = await obtenerExhibidor(db, id.data);
    if (!ex) return [null, null, []] as const;
    const [v, c] = await Promise.all([
      obtenerVendedor(db, ex.vendedorId),
      historialDeCambios(db, 'exhibidor', ex.id),
    ]);
    return [ex, v, c] as const;
  });
  if (!e) notFound();
  const abierto = e.estado === 'abierto';
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <AvisoIndiceSucio version={e.version} />
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{e.nombre}</h1>
          <EtiquetaEstado vista={vistaEstadoExhibidor(e.estado)} grande />
        </div>
        <p className="text-dato text-tinta-suave">
          <Link href={`/panel/vendedores/${e.vendedorId}`} className="enlace">
            {e.vendedorNombre}
          </Link>{' '}
          · {e.fechaEnvio}
        </p>
      </div>
      {!abierto && (
        <p role="status" className="aviso-exito">
          Exhibidor cerrado.
        </p>
      )}
      {abierto && vendedor && !vendedor.activo && (
        <p className="aviso-atencion">
          El vendedor de este exhibidor está inactivo: no se podrán enviar piezas hasta reactivarlo.
        </p>
      )}
      {abierto ? (
        <details className="tarjeta p-4">
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
        <p className="text-meta text-tinta-suave">
          Un exhibidor cerrado es un registro histórico: su nombre y su fecha de envío ya no se editan.
        </p>
      )}
      {abierto && (
        <div className="grid gap-6 md:grid-cols-2">
          <FormAccion accion={accionEnviar} textoBoton="Enviar piezas" limpiarAlGuardar>
            <input type="hidden" name="exhibidorId" value={e.id} />
            <AreaTexto
              etiqueta="Códigos a enviar"
              name="codigos"
              rows={5}
              required
              maxLength={20000}
              placeholder="Uno por línea o separados por espacio o coma"
            />
          </FormAccion>
          <FormAccion accion={accionRegresar} textoBoton="Regresar piezas" limpiarAlGuardar>
            <input type="hidden" name="exhibidorId" value={e.id} />
            <AreaTexto etiqueta="Códigos a regresar" name="codigos" rows={5} required maxLength={20000} />
          </FormAccion>
        </div>
      )}
      <h2 className="text-lg font-semibold">Piezas en el exhibidor ({e.piezasActuales})</h2>
      <ul className="tarjeta flex flex-col divide-y empty:hidden divide-borde px-4 text-dato">
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
      {e.piezas.length === 0 && (
        <p className="text-meta text-tinta-suave">No hay piezas en este exhibidor.</p>
      )}
      <section aria-labelledby="apartadas-exhibidor" className="flex flex-col gap-2">
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
      {abierto && e.piezasActuales === 0 && (
        <FormAccion accion={accionCerrar} textoBoton="Cerrar exhibidor">
          {/* key por versión en los campos (no en el formulario): refresca sin perder el estado de la acción. */}
          <Fragment key={e.version}>
            <input type="hidden" name="exhibidorId" value={e.id} />
            <input type="hidden" name="version" value={e.version} />
            <label className="flex min-h-11 items-center gap-2 text-meta font-medium">
              <input type="checkbox" name="confirmo" value="si" required className="size-5" />
              Confirmo que quiero cerrar este exhibidor; no se puede reabrir.
            </label>
          </Fragment>
          <p className="text-meta text-tinta-suave">
            Las piezas apartadas (listadas arriba) impiden cerrar el exhibidor: hay que resolver sus pedidos
            primero.
          </p>
        </FormAccion>
      )}
      <HistorialCambios entradas={cambios} />
    </section>
  );
}
