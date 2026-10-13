import { conDbLectura } from '@/db/client';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarCatalogo } from '@/server/catalogos/servicio';
import { FormNuevaPieza } from './FormNuevaPieza';

export const metadata = { title: 'Nueva pieza' };

export default async function NuevaPieza() {
  await requerirSesion();
  // Tres lecturas por la vista v_catalogo en una sola ronda (sin N+1).
  const [categorias, materiales, proveedores] = await conDbLectura((db) =>
    Promise.all([
      listarCatalogo(db, 'categoria'),
      listarCatalogo(db, 'material'),
      listarCatalogo(db, 'proveedor'),
    ]),
  );
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nueva pieza</h1>
      <FormNuevaPieza
        categorias={categorias.map((c) => c.nombre)}
        materiales={materiales.map((c) => c.nombre)}
        proveedores={proveedores.map((c) => c.nombre)}
      />
    </section>
  );
}
