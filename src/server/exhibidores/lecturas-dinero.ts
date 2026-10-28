import { and, asc, desc, eq, exists, gt, or } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import {
  aplicacionPago,
  cliente,
  entregaExhibidor,
  movimientoPieza,
  pago,
  vAdmin,
  vExhibidor,
  vPedido,
} from '@/db/schema';
import { numericACentavos } from '@/domain/dinero';

// Plan 4a, Task 3: lo que el exhibidor cobró, entregó y debe entregar (E-5).

export async function resumenDineroExhibidor(db: Ejecutor, exhibidorId: string) {
  const [v] = await db
    .select({
      cobrado: vExhibidor.cobrado,
      entregado: vExhibidor.entregado,
      ajustes: vExhibidor.ajustes,
      porEntregar: vExhibidor.porEntregar,
    })
    .from(vExhibidor)
    .where(eq(vExhibidor.id, exhibidorId));
  return {
    cobradoCentavos: numericACentavos(v?.cobrado ?? '0'),
    entregadoCentavos: numericACentavos(v?.entregado ?? '0'),
    ajustesCentavos: numericACentavos(v?.ajustes ?? '0'),
    porEntregarCentavos: numericACentavos(v?.porEntregar ?? '0'),
  };
}

export interface MovimientoDinero {
  fecha: string;
  tipo: 'cobro' | 'entrega' | 'ajuste';
  montoCentavos: number;
  folio: number | null;
  clienteNombre: string | null;
  metodo: string | null;
  nota: string | null;
  adminNombre: string;
}

/** Cobros (pagos del exhibidor), entregas y ajustes, el más reciente primero. */
export async function historialDineroExhibidor(
  db: Ejecutor,
  exhibidorId: string,
): Promise<MovimientoDinero[]> {
  const [cobros, entregas] = await Promise.all([
    db
      .select({
        id: pago.id,
        fecha: pago.fecha,
        creado: pago.createdAt,
        monto: pago.monto,
        metodo: pago.metodo,
        nota: pago.nota,
        folio: vPedido.folio,
        clienteNombre: cliente.nombre,
        adminNombre: vAdmin.email,
      })
      .from(pago)
      .innerJoin(vAdmin, eq(vAdmin.id, pago.adminId))
      .leftJoin(cliente, eq(cliente.id, pago.pagadorClienteId))
      .leftJoin(aplicacionPago, eq(aplicacionPago.pagoId, pago.id))
      .leftJoin(vPedido, eq(vPedido.id, aplicacionPago.pedidoId))
      .where(eq(pago.exhibidorId, exhibidorId))
      .orderBy(asc(aplicacionPago.createdAt)),
    db
      .select({
        fecha: entregaExhibidor.fecha,
        creado: entregaExhibidor.createdAt,
        tipo: entregaExhibidor.tipo,
        monto: entregaExhibidor.monto,
        metodo: entregaExhibidor.metodo,
        nota: entregaExhibidor.nota,
        adminNombre: vAdmin.email,
      })
      .from(entregaExhibidor)
      .innerJoin(vAdmin, eq(vAdmin.id, entregaExhibidor.adminId))
      .where(eq(entregaExhibidor.exhibidorId, exhibidorId)),
  ]);
  // Un pago se aplica a una nota; si hubiera varias filas, queda la primera aplicación.
  const vistos = new Set<string>();
  const filas = [
    ...cobros
      .filter((c) => !vistos.has(c.id) && vistos.add(c.id))
      .map((c) => ({
        creado: c.creado,
        m: {
          fecha: c.fecha,
          tipo: 'cobro' as const,
          montoCentavos: numericACentavos(c.monto),
          folio: c.folio,
          clienteNombre: c.clienteNombre,
          metodo: c.metodo,
          nota: c.nota,
          adminNombre: c.adminNombre,
        },
      })),
    ...entregas.map((e) => ({
      creado: e.creado,
      m: {
        fecha: e.fecha,
        tipo: e.tipo,
        montoCentavos: numericACentavos(e.monto),
        folio: null,
        clienteNombre: null,
        metodo: e.metodo,
        nota: e.nota,
        adminNombre: e.adminNombre,
      },
    })),
  ];
  return filas
    .sort((a, b) => b.m.fecha.localeCompare(a.m.fecha) || b.creado.getTime() - a.creado.getTime())
    .map((f) => f.m);
}

/**
 * «Ventas del exhibidor»: notas con alguna pieza que se apartó (movimiento `apartado`, que conserva el exhibidor
 * de la pieza) desde este exhibidor, o con un pago cobrado por él. La venta en un paso cumple ambas; una nota
 * normal con una pieza que estaba en el exhibidor cumple la primera. Incluye canceladas (se ve su estado).
 */
export async function ventasDeExhibidor(db: Ejecutor, exhibidorId: string) {
  const filas = await db
    .select({
      pedidoId: vPedido.id,
      folio: vPedido.folio,
      clienteNombre: vPedido.clienteNombre,
      esMostrador: cliente.esMostrador,
      fecha: vPedido.fecha,
      total: vPedido.total,
      saldo: vPedido.saldo,
      estado: vPedido.estado,
    })
    .from(vPedido)
    .innerJoin(cliente, eq(cliente.id, vPedido.clienteId))
    .where(
      or(
        exists(
          db
            .select({ x: movimientoPieza.id })
            .from(movimientoPieza)
            .where(
              and(
                eq(movimientoPieza.pedidoId, vPedido.id),
                eq(movimientoPieza.tipo, 'apartado'),
                eq(movimientoPieza.exhibidorId, exhibidorId),
              ),
            ),
        ),
        exists(
          db
            .select({ x: aplicacionPago.id })
            .from(aplicacionPago)
            .innerJoin(pago, eq(pago.id, aplicacionPago.pagoId))
            .where(and(eq(aplicacionPago.pedidoId, vPedido.id), eq(pago.exhibidorId, exhibidorId))),
        ),
      ),
    )
    .orderBy(desc(vPedido.fecha), desc(vPedido.folio));
  return filas.map((f) => ({
    pedidoId: f.pedidoId,
    folio: f.folio,
    clienteNombre: f.clienteNombre,
    esMostrador: f.esMostrador,
    fecha: f.fecha,
    totalCentavos: numericACentavos(f.total),
    saldoCentavos: numericACentavos(f.saldo),
    estado: f.estado,
  }));
}

/** Exhibidores con dinero por entregar (> 0), el que más debe primero. */
export async function exhibidoresPorEntregar(db: Ejecutor) {
  const filas = await db
    .select({
      id: vExhibidor.id,
      nombre: vExhibidor.nombre,
      vendedorNombre: vExhibidor.vendedorNombre,
      porEntregar: vExhibidor.porEntregar,
    })
    .from(vExhibidor)
    .where(gt(vExhibidor.porEntregar, '0'))
    .orderBy(desc(vExhibidor.porEntregar), asc(vExhibidor.nombre));
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    vendedorNombre: f.vendedorNombre,
    porEntregarCentavos: numericACentavos(f.porEntregar),
  }));
}
