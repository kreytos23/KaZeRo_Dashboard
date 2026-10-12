import { Fragment } from 'react';
import { conDbLectura } from '@/db/client';
import { HistorialCambios } from '@/features/auditoria/HistorialCambios';
import { Campo } from '@/features/ui/Campo';
import { CampoMotivo } from '@/features/ui/CampoMotivo';
import { FormAccion } from '@/features/ui/FormAccion';
import { historialPorEntidad } from '@/server/auditoria/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarCatalogo, type TipoCatalogo } from '@/server/catalogos/servicio';
import { accionCrearCatalogo, accionRenombrarCatalogo } from './acciones';

const SECCIONES: { tipo: TipoCatalogo; titulo: string; etiqueta: string }[] = [
  { tipo: 'categoria', titulo: 'Categorías', etiqueta: 'Nueva categoría' },
  { tipo: 'material', titulo: 'Materiales', etiqueta: 'Nuevo material' },
  { tipo: 'proveedor', titulo: 'Proveedores', etiqueta: 'Nuevo proveedor' },
];

export const metadata = { title: 'Catálogos' };

export default async function PaginaCatalogos() {
  await requerirSesion();
  const [listas, cambios] = await conDbLectura((db) =>
    Promise.all([
      Promise.all(SECCIONES.map((s) => listarCatalogo(db, s.tipo))),
      historialPorEntidad(db, ['categoria', 'material', 'proveedor']),
    ]),
  );
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
              <li key={c.id}>
                <details>
                  <summary className="min-h-11 cursor-pointer content-center">
                    {c.nombre}
                    <span className="sr-only"> (renombrar)</span>
                  </summary>
                  <div className="flex flex-col gap-3 py-2">
                    <FormAccion accion={accionRenombrarCatalogo} textoBoton="Guardar nombre">
                      <Fragment key={c.version}>
                        <input type="hidden" name="tipo" value={s.tipo} />
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="version" value={c.version} />
                        <Campo
                          etiqueta={`Nuevo nombre para ${c.nombre}`}
                          name="nombre"
                          defaultValue={c.nombre}
                          required
                          maxLength={80}
                        />
                        <CampoMotivo />
                      </Fragment>
                    </FormAccion>
                    <HistorialCambios
                      entradas={cambios.get(c.id) ?? []}
                      idTitulo={`historial-${c.id}`}
                      titulo={`Cambios de ${c.nombre}`}
                      nivel={3}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
