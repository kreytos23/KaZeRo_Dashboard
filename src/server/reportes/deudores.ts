import { and, eq, gt } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { vCliente, vPedido } from '@/db/schema';
import { agruparDeudores, type GrupoDeudores } from '@/domain/deudores';
import { numericACentavos } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';

/** Pedidos abiertos con saldo, agrupados por vendedora. Sin paginación: el volumen de una joyería es chico. */
export async function reporteDeudores(
  db: Ejecutor,
  o: { vendedorId?: string; hoy?: string } = {},
): Promise<{ fecha: string; grupos: GrupoDeudores[]; totalCentavos: number; numPedidos: number }> {
  const fecha = o.hoy ?? hoyMX();
  const filas = await db
    .select({
      pedidoId: vPedido.id,
      folio: vPedido.folio,
      vendedorId: vPedido.vendedorId,
      vendedorNombre: vPedido.vendedorNombre,
      clienteNombre: vCliente.nombre,
      telefono: vCliente.telefono,
      fecha: vPedido.fecha,
      total: vPedido.total,
      pagado: vPedido.pagado,
      saldo: vPedido.saldo,
    })
    .from(vPedido)
    .innerJoin(vCliente, eq(vCliente.id, vPedido.clienteId))
    .where(
      and(
        eq(vPedido.estado, 'abierto'),
        gt(vPedido.saldo, '0'),
        o.vendedorId ? eq(vPedido.vendedorId, o.vendedorId) : undefined,
      ),
    );
  return {
    fecha,
    ...agruparDeudores(
      filas.map((f) => ({
        pedidoId: f.pedidoId,
        folio: f.folio,
        vendedorId: f.vendedorId,
        vendedorNombre: f.vendedorNombre,
        clienteNombre: f.clienteNombre,
        telefono: f.telefono,
        fecha: f.fecha,
        totalCentavos: numericACentavos(f.total),
        pagadoCentavos: numericACentavos(f.pagado),
        saldoCentavos: numericACentavos(f.saldo),
      })),
      fecha,
    ),
  };
}
