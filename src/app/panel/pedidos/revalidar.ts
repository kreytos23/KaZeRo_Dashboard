import 'server-only';
import { revalidatePath } from 'next/cache';

/** Un pedido toca piezas, cliente, vendedor y exhibidor: ruta literal + patrón (lecciones §4). */
export function revalidarPedido(folio: number) {
  revalidatePath(`/panel/pedidos/${folio}`);
  revalidarPedidos();
}

/** Lo mismo sin un folio concreto (pago agrupado: toca varios pedidos). */
export function revalidarPedidos() {
  revalidatePath('/panel/pedidos');
  revalidatePath('/panel/pedidos/[folio]', 'page');
  revalidatePath('/panel/clientes/[id]', 'page');
  revalidatePath('/panel/vendedores/[id]', 'page');
  revalidatePath('/panel/exhibidores/[id]', 'page');
  revalidatePath('/panel/exhibidores');
  revalidatePath('/panel/inventario');
  revalidatePath('/panel/inventario/[codigo]', 'page');
}
