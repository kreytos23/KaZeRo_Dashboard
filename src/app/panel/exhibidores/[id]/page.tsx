import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDb } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { AreaTexto } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { obtenerExhibidor } from '@/server/exhibidores/servicio';
import { obtenerVendedor } from '@/server/vendedores/servicio';
import { accionCerrar, accionEnviar, accionRegresar } from '../acciones';

export default async function FichaExhibidor({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [e, vendedor] = await conDb(async (db) => {
    const ex = await obtenerExhibidor(db, id.data);
    return [ex, ex ? await obtenerVendedor(db, ex.vendedorId) : null] as const;
  });
  if (!e) notFound();
  const abierto = e.estado === 'abierto';
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{e.nombre}</h1>
        <p className="text-stone-600">
          <Link href={`/panel/vendedores/${e.vendedorId}`} className="underline">
            {e.vendedorNombre}
          </Link>{' '}
          · {e.fechaEnvio} · {abierto ? 'Abierto' : 'Cerrado'}
        </p>
      </div>
      {!abierto && (
        <p role="status" className="text-sm text-green-700">
          Exhibidor cerrado.
        </p>
      )}
      {abierto && vendedor && !vendedor.activo && (
        <p className="text-sm text-amber-800">
          El vendedor de este exhibidor está inactivo: no se podrán enviar piezas hasta reactivarlo.
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
      <ul className="flex flex-col divide-y divide-stone-200 text-sm">
        {e.piezas.map((p) => (
          <li key={p.id} className="py-2">
            <Link href={`/panel/inventario/${encodeURIComponent(p.codigo)}`} className="font-mono underline">
              {p.codigo}
            </Link>{' '}
            · {p.descripcion} · {formatoMXN(numericACentavos(p.precio))}
          </li>
        ))}
      </ul>
      {e.piezas.length === 0 && <p className="text-sm text-stone-600">No hay piezas en este exhibidor.</p>}
      {abierto && e.piezasActuales === 0 && (
        <FormAccion accion={accionCerrar} textoBoton="Cerrar exhibidor">
          {/* key por versión en los campos (no en el formulario): refresca sin perder el estado de la acción. */}
          <Fragment key={e.version}>
            <input type="hidden" name="exhibidorId" value={e.id} />
            <input type="hidden" name="version" value={e.version} />
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="confirmo" value="si" required className="size-5" />
              Confirmo que quiero cerrar este exhibidor; no se puede reabrir.
            </label>
          </Fragment>
          <p className="text-sm text-stone-600">
            Si hay piezas apartadas ligadas a este exhibidor, no se podrá cerrar hasta resolver sus pedidos.
          </p>
        </FormAccion>
      )}
    </section>
  );
}
