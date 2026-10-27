import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { FotoPieza } from '@/features/imagenes/FotoPieza';
import { Campo, Selector } from '@/features/ui/Campo';
import { CampoConLista } from '@/features/ui/CampoConLista';
import { EstadoVacio } from '@/features/ui/EstadoVacio';
import { EtiquetaEstado } from '@/features/ui/EtiquetaEstado';
import { vistaEstadoPieza, vistaUbicacion } from '@/features/ui/estado-visual';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarCatalogo } from '@/server/catalogos/servicio';
import { listarPiezas } from '@/server/piezas/servicio';
import { listarVendedores } from '@/server/vendedores/servicio';
import { ETIQUETA_ESTADO, ETIQUETA_UBICACION_FILTRO } from './etiquetas';
import { POR_PAGINA, idDeCatalogo, leerFiltros } from './filtros';

export const metadata = { title: 'Inventario' };

export default async function PaginaInventario({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const f = leerFiltros(await searchParams);
  // Los filtros de catálogo llegan por nombre: se resuelven a id con las listas (que el formulario también usa).
  const [catalogos, piezas, vendedoras] = await conDbLectura(async (db) => {
    const cat = await Promise.all([
      listarCatalogo(db, 'categoria'),
      listarCatalogo(db, 'material'),
      listarCatalogo(db, 'proveedor'),
    ]);
    const pz = await listarPiezas(db, {
      q: f.q,
      estado: f.estado,
      ubicacion: f.ubicacion,
      vendedorId: f.vendedor,
      categoriaId: idDeCatalogo(cat[0], f.categoria),
      materialId: idDeCatalogo(cat[1], f.material),
      proveedorId: idDeCatalogo(cat[2], f.proveedor),
      limite: POR_PAGINA,
      offset: (f.pagina - 1) * POR_PAGINA,
    });
    const vs = await listarVendedores(db);
    return [cat, pz, vs.filter((v) => v.tipo !== 'casa')] as const;
  });
  const [categorias, materiales, proveedores] = catalogos;
  const conPagina = (p: number) => {
    const qs = new URLSearchParams();
    if (f.q) qs.set('q', f.q);
    if (f.estado) qs.set('estado', f.estado);
    if (f.ubicacion) qs.set('ubicacion', f.ubicacion);
    if (f.vendedor) qs.set('vendedor', f.vendedor);
    if (f.categoria) qs.set('categoria', f.categoria);
    if (f.material) qs.set('material', f.material);
    if (f.proveedor) qs.set('proveedor', f.proveedor);
    qs.set('pagina', String(p));
    return `?${qs}`;
  };
  const filtrado = Boolean(
    f.q || f.estado || f.categoria || f.material || f.proveedor || f.ubicacion || f.vendedor || f.pagina > 1,
  );
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Inventario</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/panel/inventario/nueva" className="boton-primario">
            Nueva pieza
          </Link>
          <Link href="/panel/inventario/lote" className="boton-secundario">
            Alta por lote
          </Link>
        </div>
      </div>
      <form role="search" className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Código o descripción" name="q" type="search" defaultValue={f.q} maxLength={120} />
        <Selector
          etiqueta="Estado"
          name="estado"
          defaultValue={f.estado ?? ''}
          opciones={[
            { valor: '', texto: 'Todos' },
            ...Object.entries(ETIQUETA_ESTADO).map(([valor, texto]) => ({ valor, texto })),
          ]}
        />
        <Selector
          etiqueta="Ubicación"
          name="ubicacion"
          defaultValue={f.ubicacion ?? ''}
          opciones={[
            { valor: '', texto: 'Todas' },
            ...Object.entries(ETIQUETA_UBICACION_FILTRO).map(([valor, texto]) => ({ valor, texto })),
          ]}
        />
        <Selector
          etiqueta="Vendedora"
          name="vendedor"
          defaultValue={f.vendedor ?? ''}
          opciones={[
            { valor: '', texto: 'Cualquiera' },
            ...vendedoras.map((v) => ({ valor: v.id, texto: v.nombre })),
          ]}
        />
        <CampoConLista
          etiqueta="Categoría"
          name="categoria"
          opciones={categorias.map((c) => c.nombre)}
          defaultValue={f.categoria}
          maxLength={80}
          textoNuevo="Filtrar por"
        />
        <CampoConLista
          etiqueta="Material"
          name="material"
          opciones={materiales.map((c) => c.nombre)}
          defaultValue={f.material}
          maxLength={80}
          textoNuevo="Filtrar por"
        />
        <CampoConLista
          etiqueta="Proveedor"
          name="proveedor"
          opciones={proveedores.map((c) => c.nombre)}
          defaultValue={f.proveedor}
          maxLength={80}
          textoNuevo="Filtrar por"
        />
        <button className="boton-secundario">Filtrar</button>
      </form>
      {piezas.length === 0 ? (
        filtrado ? (
          <EstadoVacio
            titulo="No hay piezas con esos filtros."
            detalle="Prueba con otros datos o quita los filtros para ver todo el inventario."
            accion={{ href: '/panel/inventario', texto: 'Quitar filtros' }}
          />
        ) : (
          <EstadoVacio
            titulo="Aún no hay piezas en el inventario."
            detalle="Da de alta la primera, o pega varias a la vez desde Excel con el alta por lote."
            accion={{ href: '/panel/inventario/nueva', texto: 'Nueva pieza' }}
            principal
          />
        )
      ) : (
        <>
          {/* < md: una tarjeta por pieza con código, descripción, precio, estado y ubicación a la vista. */}
          <ul aria-label="Piezas del inventario" className="flex flex-col gap-2 md:hidden">
            {piezas.map((p) => (
              <li key={p.id} className="tarjeta tarjeta-enlace relative flex gap-3 p-3">
                <FotoPieza piezaId={p.id} clave={p.imagenClave} alt="" variante="mini" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    {/* Enlace extendido a toda la tarjeta: el toque no exige apuntar al texto. */}
                    <Link
                      href={`/panel/inventario/${encodeURIComponent(p.codigo)}`}
                      className="enlace font-mono text-monto font-semibold after:absolute after:inset-0 after:content-['']"
                    >
                      {p.codigo}
                    </Link>
                    <span className="text-monto font-semibold tabular-nums">
                      {formatoMXN(numericACentavos(p.precio))}
                    </span>
                  </div>
                  <p className="text-dato">{p.descripcion}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <EtiquetaEstado vista={vistaEstadoPieza(p.estado)} />
                    <EtiquetaEstado vista={vistaUbicacion(p.ubicacion, p.ubicacionEtiqueta)} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="tarjeta hidden overflow-x-auto px-2 md:block">
            <table className="w-full text-left text-dato">
              <caption className="sr-only">Piezas del inventario</caption>
              <thead className="text-meta font-semibold text-tinta-suave">
                <tr>
                  <th scope="col" className="px-3 py-3">
                    Foto
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Código
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Descripción
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Categoría
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    Precio
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Ubicación
                  </th>
                </tr>
              </thead>
              <tbody>
                {piezas.map((p) => (
                  <tr key={p.id} className="border-t border-borde">
                    <td className="px-3 py-2">
                      <FotoPieza piezaId={p.id} clave={p.imagenClave} alt="" variante="mini" />
                    </td>
                    <td className="px-3 py-2 font-mono text-monto font-semibold">
                      <Link
                        href={`/panel/inventario/${encodeURIComponent(p.codigo)}`}
                        className="enlace inline-flex min-h-11 items-center"
                      >
                        {p.codigo}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{p.descripcion}</td>
                    <td className="px-3 py-2">{p.categoriaNombre}</td>
                    <td className="px-3 py-2 text-right text-monto font-semibold tabular-nums">
                      {formatoMXN(numericACentavos(p.precio))}
                    </td>
                    <td className="px-3 py-2">
                      <EtiquetaEstado vista={vistaEstadoPieza(p.estado)} />
                    </td>
                    <td className="px-3 py-2">
                      <EtiquetaEstado vista={vistaUbicacion(p.ubicacion, p.ubicacionEtiqueta)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <nav aria-label="Páginas" className="flex gap-2">
        {f.pagina > 1 && (
          <Link href={conPagina(f.pagina - 1)} className="flex min-h-11 items-center px-3 enlace">
            Anterior
          </Link>
        )}
        {piezas.length === POR_PAGINA && (
          <Link href={conPagina(f.pagina + 1)} className="flex min-h-11 items-center px-3 enlace">
            Siguiente
          </Link>
        )}
      </nav>
    </section>
  );
}
