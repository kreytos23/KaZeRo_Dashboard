import { asc, desc } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { vCliente, vPedido, vPieza, vVendedor } from '@/db/schema';
import type { IndiceBusqueda } from '@/search/tipos';

/**
 * Cuatro consultas fijas contra las vistas de lectura, sin importar el tamaño del inventario.
 * Incluye todos los estados de pieza (vendida, regalo…): la búsqueda debe poder encontrarlas.
 */
export async function construirIndice(db: Ejecutor): Promise<IndiceBusqueda> {
  const [piezas, clientes, vendedores, pedidos] = await Promise.all([
    db
      .select({
        id: vPieza.id,
        codigo: vPieza.codigo,
        descripcion: vPieza.descripcion,
        estado: vPieza.estado,
        imagen: vPieza.imagenClave,
      })
      .from(vPieza)
      .orderBy(asc(vPieza.codigo)),
    db
      .select({ id: vCliente.id, nombre: vCliente.nombre, referencia: vCliente.referencia })
      .from(vCliente)
      .orderBy(asc(vCliente.nombre)),
    db.select({ id: vVendedor.id, nombre: vVendedor.nombre }).from(vVendedor).orderBy(asc(vVendedor.nombre)),
    db
      .select({
        id: vPedido.id,
        folio: vPedido.folio,
        cliente: vPedido.clienteNombre,
        estado: vPedido.estado,
      })
      .from(vPedido)
      .orderBy(desc(vPedido.folio)),
  ]);
  return {
    v: 3,
    piezas: piezas.map((p) => [p.id, p.codigo, p.descripcion, p.estado, p.imagen]),
    clientes: clientes.map((c) => [c.id, c.nombre, c.referencia]),
    vendedores: vendedores.map((v) => [v.id, v.nombre]),
    pedidos: pedidos.map((p) => [p.id, p.folio, p.cliente, p.estado]),
  };
}
