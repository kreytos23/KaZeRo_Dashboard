import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { porcentajeLegible } from '@/domain/dinero';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { Campo, Selector } from '@/features/ui/Campo';
import { CampoMotivo } from '@/features/ui/CampoMotivo';
import { FormAccion } from '@/features/ui/FormAccion';
import { AvisoIndiceSucio } from '@/search/AvisoIndiceSucio';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarExhibidores } from '@/server/exhibidores/servicio';
import { obtenerVendedor } from '@/server/vendedores/servicio';
import { accionEditarVendedor } from '../acciones';
import { TIPOS } from '../tipos';

export const metadata = { title: 'Vendedor' };

export default async function FichaVendedor({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [v, exhibidores, cambios] = await conDbLectura((db) =>
    Promise.all([
      obtenerVendedor(db, id.data),
      listarExhibidores(db, { vendedorId: id.data }),
      historialDeCambios(db, 'vendedor', id.data),
    ]),
  );
  if (!v) notFound();
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <AvisoIndiceSucio version={v.version} />
      <h1 className="text-2xl font-semibold">{v.nombre}</h1>
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
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="activo" defaultChecked={v.activo} className="size-5" /> Activo
          </label>
          <CampoMotivo montos={[{ name: 'comision', tipo: 'porcentaje' }]} />
        </Fragment>
      </FormAccion>
      <h2 className="text-lg font-semibold">Exhibidores</h2>
      <ul className="flex flex-col gap-1">
        {exhibidores.map((e) => (
          <li key={e.id}>
            <Link href={`/panel/exhibidores/${e.id}`} className="enlace">
              {e.nombre}
            </Link>{' '}
            · {e.estado} · {e.piezasActuales} piezas
          </li>
        ))}
      </ul>
      <HistorialCambios entradas={cambios} />
    </section>
  );
}
