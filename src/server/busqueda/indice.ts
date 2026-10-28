import { asc, desc, eq } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { vCliente, vPedido, vPieza, vVendedor } from '@/db/schema';
import { etiquetaUbicacion } from '@/domain/ubicacion';
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
        ubicacion: vPieza.ubicacion,
        exhibidorNombre: vPieza.exhibidorNombre,
        vendedorNombre: vPieza.vendedorCustodiaNombre,
      })
      .from(vPieza)
      .orderBy(asc(vPieza.codigo)),
    db
      .select({ id: vCliente.id, nombre: vCliente.nombre, referencia: vCliente.referencia })
      .from(vCliente)
      // «Venta de mostrador» es interna (Plan 4a): no se busca ni se elige como clienta.
      .where(eq(vCliente.esMostrador, false))
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
    v: 4,
    // La etiqueta de ubicación solo viaja cuando dice algo más que el estado: exhibidor o vendedora.
    piezas: piezas.map((p) => [
      p.id,
      p.codigo,
      p.descripcion,
      p.estado,
      p.imagen,
      p.ubicacion === 'exhibidor' || p.ubicacion === 'vendedora' ? etiquetaUbicacion(p) : null,
    ]),
    clientes: clientes.map((c) => [c.id, c.nombre, c.referencia]),
    vendedores: vendedores.map((v) => [v.id, v.nombre]),
    pedidos: pedidos.map((p) => [p.id, p.folio, p.cliente, p.estado]),
  };
}
