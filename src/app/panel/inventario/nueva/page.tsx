import { conDbLectura } from '@/db/client';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarCatalogo } from '@/server/catalogos/servicio';
import { FormNuevaPieza } from './FormNuevaPieza';

export const metadata = { title: 'Nueva pieza' };

export default async function NuevaPieza() {
  await requerirSesion();
  const categorias = await conDbLectura((db) => listarCatalogo(db, 'categoria'));
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nueva pieza</h1>
      <FormNuevaPieza categorias={categorias.map((c) => c.nombre)} />
    </section>
  );
}
