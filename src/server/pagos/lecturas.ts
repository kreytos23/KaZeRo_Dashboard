import { and, asc, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Ejecutor } from '@/db/pool';
import { admin, aplicacionPago, cliente, pago, pedido, vendedor, vPedido } from '@/db/schema';
import { numericACentavos } from '@/domain/dinero';

/** Clave vigente del comprobante de un pago (la ruta protegida nunca confía en una del cliente). */
export async function claveDeComprobante(db: Ejecutor, pagoId: string): Promise<string | null> {
  const [r] = await db.select({ clave: pago.comprobanteClave }).from(pago).where(eq(pago.id, pagoId));
  return r?.clave ?? null;
}

/** Ficha de un pago: datos, quién lo registró y lo deshizo, y sus aplicaciones con el folio del pedido. */
export async function obtenerPago(db: Ejecutor, pagoId: string) {
  const anulador = alias(admin, 'anulador');
  const [[p], aplicaciones] = await Promise.all([
    db
      .select({
        id: pago.id,
        fecha: pago.fecha,
        monto: pago.monto,
        metodo: pago.metodo,
        nota: pago.nota,
        referencia: pago.referencia,
        comprobanteClave: pago.comprobanteClave,
        createdAt: pago.createdAt,
        anuladoAt: pago.anuladoAt,
        anulacionMotivo: pago.anulacionMotivo,
        anuladoPor: pago.anuladoPor,
        anuladoPorEmail: anulador.email,
        registradoPor: admin.email,
        exhibidorId: pago.exhibidorId,
        clienteId: pago.pagadorClienteId,
        clienteNombre: cliente.nombre,
        vendedorId: pago.pagadorVendedorId,
        vendedorNombre: vendedor.nombre,
      })
      .from(pago)
      .innerJoin(admin, eq(admin.id, pago.adminId))
      .leftJoin(cliente, eq(cliente.id, pago.pagadorClienteId))
      .leftJoin(vendedor, eq(vendedor.id, pago.pagadorVendedorId))
      .leftJoin(anulador, eq(anulador.id, pago.anuladoPor))
      .where(eq(pago.id, pagoId)),
    db
      .select({
        id: aplicacionPago.id,
        monto: aplicacionPago.monto,
        pedidoId: pedido.id,
        folio: pedido.folio,
        clienteNombre: cliente.nombre,
      })
      .from(aplicacionPago)
      .innerJoin(pedido, eq(pedido.id, aplicacionPago.pedidoId))
      .innerJoin(cliente, eq(cliente.id, pedido.clienteId))
      .where(eq(aplicacionPago.pagoId, pagoId))
      .orderBy(asc(pedido.folio)),
  ]);
  if (!p) return null;
  const aplicado = aplicaciones.reduce((s, a) => s + numericACentavos(a.monto), 0);
  return {
    ...p,
    aplicaciones,
    /** Lo que no se aplicó a ningún pedido (pago agrupado): fue a saldo a favor de la vendedora. */
    sobranteCentavos: Math.max(0, numericACentavos(p.monto) - aplicado),
  };
}

/** Pedidos abiertos con saldo de una vendedora, para repartir su pago (el reparto los ordena del más viejo al más nuevo). */
export async function pedidosAbiertosDeVendedora(db: Ejecutor, vendedorId: string) {
  const filas = await db
    .select({
      id: vPedido.id,
      folio: vPedido.folio,
      fecha: vPedido.fecha,
      saldo: vPedido.saldo,
      clienteNombre: vPedido.clienteNombre,
    })
    .from(vPedido)
    .where(and(eq(vPedido.vendedorId, vendedorId), eq(vPedido.estado, 'abierto')))
    .orderBy(asc(vPedido.fecha), asc(vPedido.folio), desc(vPedido.id));
  return filas
    .map((f) => ({ ...f, saldoCentavos: numericACentavos(f.saldo) }))
    .filter((f) => f.saldoCentavos > 0);
}
