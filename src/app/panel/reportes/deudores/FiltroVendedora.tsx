import { SelectorVendedora } from '../SelectorVendedora';

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
      <SelectorVendedora vendedores={vendedores} actual={actual} />
      <button type="submit" className="boton-secundario">
        Filtrar
      </button>
    </form>
  );
}
