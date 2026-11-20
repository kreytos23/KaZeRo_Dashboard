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
      etiqueta="Asociado"
      name="vendedor"
      defaultValue={actual}
      opciones={[{ valor: '', texto: 'Todos' }, ...vendedores.map((v) => ({ valor: v.id, texto: v.nombre }))]}
    />
  );
}
