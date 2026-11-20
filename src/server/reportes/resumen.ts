import { and, asc, count, eq, gte, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { pago, vCliente, vPedido, vPedidoItem, vPieza } from '@/db/schema';
import { importesConDescuento } from '@/domain/devolucion';
import { numericACentavos } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { resumirLineas, top5, type FilaTop, type LineaVendida } from '@/domain/resumen';
import { etiquetaUbicacion } from '@/domain/ubicacion';
import { reporteDeudores } from './deudores';

export interface Resumen {
  ventasCentavos: number;
  notas: number;
  cobrosCentavos: number;
  margenCentavos: number;
  baseMargenCentavos: number;
  piezasSinCosto: number;
  topVendedoras: FilaConId[];
  topCategorias: { nombre: string; centavos: number }[];
  topClientas: FilaConId[];
  porCobrarCentavos: number;
  ubicaciones: { etiqueta: string; piezas: number }[];
}

export type FilaConId = Required<FilaTop>;

const sumar = (m: Map<string, number>, llave: string, n: number) => m.set(llave, (m.get(llave) ?? 0) + n);
/** m-1: por id, no por nombre: dos clientas (o asociados) homónimas son dos filas. */
const sumarPorId = (m: Map<string, FilaConId>, id: string, nombre: string, n: number) => {
  const f = m.get(id);
  if (f) f.centavos += n;
  else m.set(id, { id, nombre, centavos: n });
};

/**
 * Resumen del periodo [desde, hasta] (fechas de negocio, columnas `date`). Cinco lecturas en paralelo, sin consultas
 * por fila; el reparto del descuento sale de `@/domain/devolucion` (el mismo que la devolución) y el margen de
 * `@/domain/resumen`.
 */
export async function resumenDePeriodo(
  db: Ejecutor,
  p: { desde: string; hasta: string; hoy?: string },
): Promise<Resumen> {
  const hoy = p.hoy ?? hoyMX();
  // M-1: notas no canceladas con fecha de negocio dentro del periodo.
  const delPeriodo = and(
    gte(vPedido.fecha, p.desde),
    lte(vPedido.fecha, p.hasta),
    ne(vPedido.estado, 'cancelado'),
  );
  const [notas, lineas, cobros, deudores, ubicaciones] = await Promise.all([
    db
      .select({
        total: vPedido.total,
        devuelto: vPedido.devuelto,
        vendedorId: vPedido.vendedorId,
        vendedorNombre: vPedido.vendedorNombre,
        clienteId: vPedido.clienteId,
        clienteNombre: vPedido.clienteNombre,
        esMostrador: vCliente.esMostrador,
      })
      .from(vPedido)
      .innerJoin(vCliente, eq(vCliente.id, vPedido.clienteId))
      .where(delPeriodo),
    db
      .select({
        pedidoId: vPedidoItem.pedidoId,
        precioFinal: vPedidoItem.precioFinal,
        devolucionId: vPedidoItem.devolucionId,
        manual: vPedido.descuentoManualMonto,
        costo: vPieza.costo,
        categoria: vPieza.categoriaNombre,
      })
      .from(vPedidoItem)
      .innerJoin(vPedido, eq(vPedido.id, vPedidoItem.pedidoId))
      .innerJoin(vPieza, eq(vPieza.id, vPedidoItem.piezaId))
      // I-1: mismo conjunto y orden que la devolución (`server/pedidos/devolucion.ts`): las líneas no quitadas, por
      // id. Las devueltas siguen en el total: entran al reparto (M-3), pero no al resultado.
      .where(and(delPeriodo, isNull(vPedidoItem.quitadoAt)))
      .orderBy(asc(vPedidoItem.pedidoId), asc(vPedidoItem.id)),
    // M-2: cobros del periodo sin los pagos deshechos ni el saldo a favor (no es dinero nuevo).
    db
      .select({ total: sql<string>`coalesce(sum(${pago.monto}), 0)` })
      .from(pago)
      .where(
        and(
          gte(pago.fecha, p.desde),
          lte(pago.fecha, p.hasta),
          isNull(pago.anuladoAt),
          ne(pago.metodo, 'saldo_favor'),
        ),
      ),
    reporteDeudores(db, { hoy }),
    // M-6: dónde está hoy lo que sigue en inventario.
    db
      .select({
        ubicacion: vPieza.ubicacion,
        exhibidorNombre: vPieza.exhibidorNombre,
        vendedorNombre: vPieza.vendedorCustodiaNombre,
        piezas: count(),
      })
      .from(vPieza)
      .where(notInArray(vPieza.estado, ['vendida', 'regalo', 'defecto']))
      .groupBy(vPieza.ubicacion, vPieza.exhibidorNombre, vPieza.vendedorCustodiaNombre),
  ]);

  const vendedoras = new Map<string, FilaConId>();
  const clientas = new Map<string, FilaConId>();
  let ventasCentavos = 0;
  for (const n of notas) {
    const neto = numericACentavos(n.total) - numericACentavos(n.devuelto);
    ventasCentavos += neto;
    sumarPorId(vendedoras, n.vendedorId, n.vendedorNombre, neto);
    // M-5: la venta de mostrador no es una clienta.
    if (!n.esMostrador) sumarPorId(clientas, n.clienteId, n.clienteNombre, neto);
  }

  const porNota = new Map<string, typeof lineas>();
  for (const l of lineas) {
    const ls = porNota.get(l.pedidoId);
    if (ls) ls.push(l);
    else porNota.set(l.pedidoId, [l]);
  }
  const vendidas: LineaVendida[] = [];
  for (const ls of porNota.values()) {
    const importes = importesConDescuento(
      ls.map((l) => numericACentavos(l.precioFinal)),
      numericACentavos(ls[0]!.manual),
    );
    ls.forEach((l, i) =>
      vendidas.push({
        importe: importes[i]!,
        costo: numericACentavos(l.costo),
        categoria: l.categoria,
        devuelta: l.devolucionId !== null,
      }),
    );
  }
  const r = resumirLineas(vendidas);

  // Dos exhibidores (o vendedoras) con el mismo nombre comparten etiqueta: se suman en una sola fila.
  const porUbicacion = new Map<string, number>();
  for (const u of ubicaciones)
    sumar(
      porUbicacion,
      etiquetaUbicacion({
        ubicacion: u.ubicacion,
        exhibidorNombre: u.exhibidorNombre,
        vendedorNombre: u.vendedorNombre,
        estado: '',
      }),
      u.piezas,
    );

  return {
    ventasCentavos,
    notas: notas.length,
    cobrosCentavos: numericACentavos(cobros[0]!.total),
    margenCentavos: r.margenCentavos,
    baseMargenCentavos: r.baseMargenCentavos,
    piezasSinCosto: r.piezasSinCosto,
    topVendedoras: top5(vendedoras.values()),
    topCategorias: top5([...r.categorias].map(([nombre, centavos]) => ({ nombre, centavos }))),
    topClientas: top5(clientas.values()),
    porCobrarCentavos: deudores.totalCentavos,
    ubicaciones: [...porUbicacion]
      .map(([etiqueta, piezas]) => ({ etiqueta, piezas }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es')),
  };
}
