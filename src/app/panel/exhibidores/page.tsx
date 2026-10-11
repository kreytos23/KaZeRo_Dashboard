import Link from 'next/link';
import { z } from 'zod';
import { conDb } from '@/db/client';
import { hoyMX } from '@/domain/fechas';
import { Campo, Selector } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarExhibidores } from '@/server/exhibidores/servicio';
import { listarVendedores } from '@/server/vendedores/servicio';
import { accionCrearExhibidor } from './acciones';

export default async function PaginaExhibidores({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const filtro = z.uuid().safeParse((await searchParams).vendedor);
  // Una sola ronda: el id del filtro ya viene validado como uuid; uno inexistente da una lista vacía.
  const [todos, exhibidores] = await conDb((db) =>
    Promise.all([
      listarVendedores(db),
      listarExhibidores(db, { vendedorId: filtro.success ? filtro.data : undefined }),
    ]),
  );
  const vendedorId = filtro.success && todos.some((v) => v.id === filtro.data) ? filtro.data : undefined;
  const activos = todos.filter((v) => v.activo);
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Exhibidores</h1>
      {activos.length === 0 ? (
        <p className="text-sm text-stone-600">
          Primero agrega un vendedor activo en{' '}
          <Link href="/panel/vendedores" className="underline">
            Vendedores
          </Link>
          .
        </p>
      ) : (
        <FormAccion accion={accionCrearExhibidor} textoBoton="Crear exhibidor" limpiarAlGuardar>
          <Selector
            etiqueta="Vendedor"
            name="vendedorId"
            required
            opciones={activos.map((v) => ({ valor: v.id, texto: v.nombre }))}
          />
          <Campo
            etiqueta="Nombre del exhibidor"
            name="nombre"
            required
            maxLength={120}
            placeholder="Exhibidor Nelly - 16sep"
          />
          <Campo etiqueta="Fecha de envío" name="fechaEnvio" type="date" defaultValue={hoyMX()} required />
        </FormAccion>
      )}
      <form role="search" className="flex flex-wrap items-end gap-2">
        <Selector
          etiqueta="Filtrar por vendedor"
          name="vendedor"
          defaultValue={vendedorId ?? ''}
          opciones={[{ valor: '', texto: 'Todos' }, ...todos.map((v) => ({ valor: v.id, texto: v.nombre }))]}
        />
        <button className="min-h-11 rounded-lg border border-stone-300 px-4">Filtrar</button>
      </form>
      <ul className="flex flex-col divide-y divide-stone-200">
        {exhibidores.map((e) => (
          <li key={e.id} className="py-2">
            <Link href={`/panel/exhibidores/${e.id}`} className="underline">
              {e.nombre}
            </Link>
            <span className="text-stone-600">
              {' '}
              · {e.vendedorNombre} · {e.fechaEnvio} · {e.estado === 'abierto' ? 'Abierto' : 'Cerrado'} ·{' '}
              {e.piezasActuales} {e.piezasActuales === 1 ? 'pieza' : 'piezas'}
            </span>
          </li>
        ))}
      </ul>
      {exhibidores.length === 0 && <p className="text-sm text-stone-600">No hay exhibidores.</p>}
    </section>
  );
}
