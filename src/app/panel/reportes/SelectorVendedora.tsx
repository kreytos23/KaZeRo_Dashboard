import { Selector } from '@/features/ui/Campo';

/** Select nativo de vendedora con «Todas»; va dentro de un formulario GET (`?vendedor=`). */
export function SelectorVendedora({
  vendedores,
  actual,
}: {
  vendedores: { id: string; nombre: string }[];
  actual: string;
}) {
  return (
    <Selector
      etiqueta="Vendedora"
      name="vendedor"
      defaultValue={actual}
      opciones={[{ valor: '', texto: 'Todas' }, ...vendedores.map((v) => ({ valor: v.id, texto: v.nombre }))]}
    />
  );
}
