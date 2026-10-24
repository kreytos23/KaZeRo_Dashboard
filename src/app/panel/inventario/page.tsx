import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import { FotoPieza } from '@/features/imagenes/FotoPieza';
import { Campo, Selector } from '@/features/ui/Campo';
import { CampoConLista } from '@/features/ui/CampoConLista';
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
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Inventario</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/panel/inventario/nueva"
            className="flex min-h-11 items-center rounded-lg bg-primario px-4 font-medium text-white hover:bg-primario-fuerte"
          >
            Nueva pieza
          </Link>
          <Link
            href="/panel/inventario/lote"
            className="flex min-h-11 items-center rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave"
          >
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
        <button className="min-h-11 rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave">
          Filtrar
        </button>
      </form>
      <div className="tarjeta overflow-x-auto px-4">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <caption className="sr-only">Piezas del inventario</caption>
          <thead>
            <tr>
              <th scope="col" className="py-2">
                Foto
              </th>
              <th scope="col">Código</th>
              <th scope="col">Descripción</th>
              <th scope="col">Categoría</th>
              <th scope="col">Precio</th>
              <th scope="col">Estado</th>
              <th scope="col">Ubicación</th>
            </tr>
          </thead>
          <tbody>
            {piezas.map((p) => (
              <tr key={p.id} className="border-t border-borde">
                <td className="py-2">
                  <FotoPieza piezaId={p.id} clave={p.imagenClave} alt="" variante="mini" />
                </td>
                <td className="py-2 font-mono">
                  <Link href={`/panel/inventario/${encodeURIComponent(p.codigo)}`} className="enlace">
                    {p.codigo}
                  </Link>
                </td>
                <td>{p.descripcion}</td>
                <td>{p.categoriaNombre}</td>
                <td>{formatoMXN(numericACentavos(p.precio))}</td>
                <td>{ETIQUETA_ESTADO[p.estado]}</td>
                <td>{p.ubicacionEtiqueta}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {piezas.length === 0 && (
          <p className="py-4 text-sm text-tinta-suave">No hay piezas con esos filtros.</p>
        )}
      </div>
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
