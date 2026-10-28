import Link from 'next/link';
import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { numericACentavos } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { Campo, Selector } from '@/features/ui/Campo';
import { EstadoVacio } from '@/features/ui/EstadoVacio';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoExhibidor } from '@/features/ui/estado-visual';
import { FormAccion } from '@/features/ui/FormAccion';
import { PorEntregar } from '@/features/exhibidores/PorEntregar';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarExhibidores } from '@/server/exhibidores/servicio';
import { listarVendedores } from '@/server/vendedores/servicio';
import { fechaCorta } from '../pedidos/etiquetas';
import { accionCrearExhibidor } from './acciones';

export const metadata = { title: 'Exhibidores' };

export default async function PaginaExhibidores({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const filtro = z.uuid().safeParse((await searchParams).vendedor);
  // Una sola ronda: el id del filtro ya viene validado como uuid; uno inexistente da una lista vacía.
  const [todos, exhibidores] = await conDbLectura((db) =>
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
        <p className="text-meta text-tinta-suave">
          Primero agrega un vendedor activo en{' '}
          <Link href="/panel/vendedores" className="enlace">
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
            placeholder="Exhibidor Perla - 16sep"
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
        <button className="boton-secundario">Filtrar</button>
      </form>
      <ul className="tarjeta flex flex-col divide-y empty:hidden divide-borde px-4">
        {exhibidores.map((e) => (
          <li
            key={e.id}
            className="fila-enlace relative flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-dato"
          >
            {/* Enlace extendido a toda la fila: el toque no exige apuntar al nombre. */}
            <Link
              href={`/panel/exhibidores/${e.id}`}
              className="enlace text-monto font-semibold after:absolute after:inset-0 after:content-['']"
            >
              {e.nombre}
            </Link>
            <EtiquetaEstado vista={vistaEstadoExhibidor(e.estado)} />
            <span className="ml-auto flex items-center gap-2">
              <span className="text-meta text-tinta-suave">Por entregar</span>
              <PorEntregar centavos={numericACentavos(e.porEntregar)} />
            </span>
            <span className="basis-full text-meta text-tinta-suave">
              {e.vendedorNombre} · {fechaCorta(e.fechaEnvio)} · {e.piezasActuales}{' '}
              {e.piezasActuales === 1 ? 'pieza' : 'piezas'}
              {e.piezasApartadas > 0 &&
                ` · ${e.piezasApartadas} ${e.piezasApartadas === 1 ? 'apartada' : 'apartadas'}`}
            </span>
          </li>
        ))}
      </ul>
      {exhibidores.length === 0 &&
        (vendedorId ? (
          <EstadoVacio
            titulo="Esa vendedora aún no tiene exhibidores."
            accion={{ href: '/panel/exhibidores', texto: 'Ver todos' }}
          />
        ) : (
          <EstadoVacio
            titulo="Aún no hay exhibidores."
            detalle={
              activos.length > 0
                ? 'Crea el primero con el formulario de arriba.'
                : 'Primero agrega un vendedor activo y luego crea el exhibidor.'
            }
          />
        ))}
    </section>
  );
}
