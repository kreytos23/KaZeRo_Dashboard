import { conDbLectura } from '@/db/client';
import { Campo } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarCatalogo, type TipoCatalogo } from '@/server/catalogos/servicio';
import { accionCrearCatalogo } from './acciones';

const SECCIONES: { tipo: TipoCatalogo; titulo: string; etiqueta: string }[] = [
  { tipo: 'categoria', titulo: 'Categorías', etiqueta: 'Nueva categoría' },
  { tipo: 'material', titulo: 'Materiales', etiqueta: 'Nuevo material' },
  { tipo: 'proveedor', titulo: 'Proveedores', etiqueta: 'Nuevo proveedor' },
];

export const metadata = { title: 'Catálogos' };

export default async function PaginaCatalogos() {
  await requerirSesion();
  const listas = await conDbLectura((db) => Promise.all(SECCIONES.map((s) => listarCatalogo(db, s.tipo))));
  return (
    <section className="grid gap-8 md:grid-cols-3">
      <h1 className="text-2xl font-semibold md:col-span-3">Catálogos</h1>
      {SECCIONES.map((s, i) => (
        <div key={s.tipo} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{s.titulo}</h2>
          <FormAccion accion={accionCrearCatalogo} textoBoton="Agregar" limpiarAlGuardar>
            <input type="hidden" name="tipo" value={s.tipo} />
            <Campo etiqueta={s.etiqueta} name="nombre" required maxLength={80} />
          </FormAccion>
          <ul className="text-sm">
            {listas[i]!.map((c) => (
              <li key={c.id}>{c.nombre}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
