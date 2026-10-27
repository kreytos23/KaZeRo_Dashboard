import { Selector } from '@/features/ui/Campo';

/** Formulario GET: funciona sin JavaScript (el select nativo y el botón envían `?vendedor=`). */
export function FiltroVendedora({
  vendedores,
  actual,
}: {
  vendedores: { id: string; nombre: string }[];
  actual: string;
}) {
  return (
    <form role="search" method="get" className="flex flex-wrap items-end gap-2">
      <Selector
        etiqueta="Vendedora"
        name="vendedor"
        defaultValue={actual}
        opciones={[
          { valor: '', texto: 'Todas' },
          ...vendedores.map((v) => ({ valor: v.id, texto: v.nombre })),
        ]}
      />
      <button type="submit" className="boton-secundario">
        Filtrar
      </button>
    </form>
  );
}
