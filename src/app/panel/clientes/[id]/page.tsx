import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conDb } from '@/db/client';
import { AreaTexto, Campo, Selector } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { obtenerCliente } from '@/server/clientes/servicio';
import { listarVendedores } from '@/server/vendedores/servicio';
import { accionEditarCliente } from '../acciones';

export default async function FichaCliente({ params }: { params: Promise<{ id: string }> }) {
  await requerirSesion();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [c, vendedores] = await conDb((db) =>
    Promise.all([obtenerCliente(db, id.data), listarVendedores(db)]),
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
        </Fragment>
      </FormAccion>
      <p className="text-sm text-stone-600">
        Los pedidos, el saldo y la tarjeta de lealtad aparecerán aquí con el módulo de pedidos.
      </p>
    </section>
  );
}
