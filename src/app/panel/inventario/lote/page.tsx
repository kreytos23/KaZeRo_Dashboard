import { MAX_FILAS_LOTE } from '@/domain/lote';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { FormLote } from './FormLote';

export const metadata = { title: 'Alta por lote' };

export default async function AltaLote() {
  await requerirSesion();
  return (
    <section className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Alta por lote</h1>
      <p className="text-meta text-tinta-suave">
        Copia las filas en Excel y pégalas aquí. Columnas: ID, Categoría, Producto, Material, Proveedor,
        Costo, P. Venta. El encabezado se ignora. Máximo {MAX_FILAS_LOTE} piezas. Si alguna fila tiene error,
        no se da de alta ninguna.
      </p>
      <FormLote />
    </section>
  );
}
