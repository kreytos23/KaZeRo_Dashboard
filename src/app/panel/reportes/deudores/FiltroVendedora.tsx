import { FormFiltros } from '@/features/ui/FormFiltros';
import { SelectorVendedora } from '../SelectorVendedora';

/** Se aplica al elegir; sin JavaScript es un formulario GET (el select nativo y «Filtrar» envían `?vendedor=`). */
export function FiltroVendedora({
  vendedores,
  actual,
}: {
  vendedores: { id: string; nombre: string }[];
  actual: string;
}) {
  return (
    <FormFiltros className="flex flex-wrap items-end gap-2" textoBoton="Filtrar">
      <SelectorVendedora vendedores={vendedores} actual={actual} />
    </FormFiltros>
  );
}
