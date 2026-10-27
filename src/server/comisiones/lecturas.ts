import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { cliente, comisionLinea, corteComision, pagoComision, pedido, vendedor } from '@/db/schema';
import {
  comisionCentavos,
  finDeMes,
  mesAbierto,
  mesCerrable,
  mesSiguiente,
  nombreMes,
  resumenPorVendedora,
  type EstadoPagoComision,
  type ResumenVendedora,
} from '@/domain/comisiones';
import { numericACentavos } from '@/domain/dinero';
import { fechaCorta, hoyMX } from '@/domain/fechas';
import { ErrorNegocio } from '@/server/errores';

export interface PedidoComisionable {
  pedidoId: string;
  folio: number;
  clienteNombre: string;
  vendedorId: string;
  vendedorNombre: string;
  fechaLiquidacion: string;
  baseCentavos: number;
  pct: string;
  montoCentavos: number;
}

export interface PagoComisionVista {
  id: string;
  fecha: string;
  metodo: (typeof pagoComision.$inferSelect)['metodo'];
  nota: string | null;
  montoCentavos: number;
}

export interface VendedoraComision extends ResumenVendedora {
  pct: string | null;
  pedidosDetalle: PedidoComisionable[];
  pago: PagoComisionVista | null;
  estadoPago: EstadoPagoComision;
}

export interface ReporteComisiones {
  mes: string;
  nombre: string;
  /** Id del corte (solo mes cerrado): lo necesita el formulario de pago. */
  corteId: string | null;
  cerrado: boolean;
  cerradoAt: string | null;
  cerrable: boolean;
  motivoNoCerrable: string | null;
  vendedoras: VendedoraComision[];
  totalCentavos: number;
  numPedidos: number;
}

export const mensajeNoTerminado = (mes: string) =>
  `${nombreMes(mes)} termina el ${fechaCorta(finDeMes(mes))}; podrás cerrarlo desde el ${fechaCorta(mesSiguiente(mes))}.`;

interface Elegible {
  pedidoId: string;
  folio: number;
  vendedorId: string;
  vendedorNombre: string;
  comisionPct: string;
  clienteNombre: string;
  total: string;
  fechaLiquidacion: string;
}

/** Pedidos liquidados sin comisionar cuya fecha de liquidación (D-3) cae hasta `finMes`. */
export async function consultaElegibles(
  tx: Ejecutor,
  finMes: string,
  o: { bloquear: boolean; vendedorId?: string },
): Promise<Elegible[]> {
  const r = await tx.execute<{
    id: string;
    folio: number;
    vendedor_id: string;
    vendedor_nombre: string;
    comision_pct: string;
    cliente_nombre: string;
    total: string;
    fl: string;
  }>(sql`
    SELECT p.id, p.folio, p.vendedor_id, v.nombre AS vendedor_nombre, v.comision_pct, c.nombre AS cliente_nombre,
           p.total, liq.f::text AS fl
      FROM pedido p
      JOIN vendedor v ON v.id = p.vendedor_id
      JOIN cliente c ON c.id = p.cliente_id
      CROSS JOIN LATERAL (SELECT kz_fecha_liquidacion(p.id) AS f) liq
     WHERE p.estado = 'liquidado'
       AND NOT EXISTS (SELECT 1 FROM comision_linea l WHERE l.pedido_id = p.id)
       AND liq.f <= ${finMes}::date
       ${o.vendedorId ? sql`AND p.vendedor_id = ${o.vendedorId}` : sql``}
     ORDER BY p.id
     ${o.bloquear ? sql`FOR UPDATE OF p` : sql``}`);
  return r.rows.map((f) => ({
    pedidoId: f.id,
    folio: f.folio,
    vendedorId: f.vendedor_id,
    vendedorNombre: f.vendedor_nombre,
    comisionPct: f.comision_pct,
    clienteNombre: f.cliente_nombre,
    total: f.total,
    fechaLiquidacion: f.fl,
  }));
}

/** D-2: el mes en curso es el siguiente al último cierre; sin cierres, el de la liquidación más antigua. */
export async function calcularMesAbierto(tx: Ejecutor, hoy: string): Promise<string> {
  const [c] = (await tx.execute<{ m: string | null }>(sql`SELECT max(mes)::text AS m FROM corte_comision`))
    .rows;
  const ultimoCerrado = c?.m ?? null;
  let liquidacionMasAntigua: string | null = null;
  if (!ultimoCerrado) {
    const [l] = (
      await tx.execute<{ f: string | null }>(sql`
        SELECT min(kz_fecha_liquidacion(p.id))::text AS f FROM pedido p WHERE p.estado = 'liquidado'`)
    ).rows;
    liquidacionMasAntigua = l?.f ?? null;
  }
  return mesAbierto({ ultimoCerrado, liquidacionMasAntigua, hoy });
}

export async function mesesComisiones(
  db: Ejecutor,
  hoy: string = hoyMX(),
): Promise<{ abierto: string; cerrados: { mes: string; cerradoAt: string }[] }> {
  const cortes = await db
    .select({ mes: corteComision.mes, cerradoAt: corteComision.cerradoAt })
    .from(corteComision)
    .orderBy(desc(corteComision.mes));
  return {
    abierto: await calcularMesAbierto(db, hoy),
    cerrados: cortes.map((c) => ({ mes: c.mes, cerradoAt: c.cerradoAt.toISOString() })),
  };
}

function armar(
  detalle: PedidoComisionable[],
  pagos: Map<string, PagoComisionVista>,
  cerrado: boolean,
): VendedoraComision[] {
  const porVendedora = new Map<string, PedidoComisionable[]>();
  for (const d of detalle) porVendedora.set(d.vendedorId, [...(porVendedora.get(d.vendedorId) ?? []), d]);
  return resumenPorVendedora(detalle).map((r) => {
    const pago = pagos.get(r.vendedorId) ?? null;
    const pedidosDetalle = porVendedora.get(r.vendedorId)!;
    return {
      ...r,
      pct: pedidosDetalle[0]!.pct,
      pedidosDetalle,
      pago,
      estadoPago: !cerrado
        ? 'estimado'
        : r.comisionCentavos === 0
          ? 'sin_comision'
          : pago
            ? 'pagado'
            : 'pendiente',
    };
  });
}

/** Mes en curso: en vivo con el % actual (estimado). Mes cerrado: las líneas congeladas y el pago vigente. */
export async function reporteComisiones(
  db: Ejecutor,
  mes: string,
  o: { vendedorId?: string; hoy?: string; abierto?: string } = {},
): Promise<ReporteComisiones> {
  const hoy = o.hoy ?? hoyMX();
  const [corte] = await db.select().from(corteComision).where(eq(corteComision.mes, mes));
  let detalle: PedidoComisionable[];
  const pagos = new Map<string, PagoComisionVista>();
  if (corte) {
    const lineas = await db
      .select({
        pedidoId: comisionLinea.pedidoId,
        folio: pedido.folio,
        clienteNombre: cliente.nombre,
        vendedorId: comisionLinea.vendedorId,
        vendedorNombre: vendedor.nombre,
        fechaLiquidacion: comisionLinea.fechaLiquidacion,
        base: comisionLinea.base,
        pct: comisionLinea.pct,
        monto: comisionLinea.monto,
      })
      .from(comisionLinea)
      .innerJoin(pedido, eq(pedido.id, comisionLinea.pedidoId))
      .innerJoin(cliente, eq(cliente.id, pedido.clienteId))
      .innerJoin(vendedor, eq(vendedor.id, comisionLinea.vendedorId))
      .where(
        and(
          eq(comisionLinea.corteId, corte.id),
          o.vendedorId ? eq(comisionLinea.vendedorId, o.vendedorId) : undefined,
        ),
      )
      .orderBy(asc(pedido.folio));
    detalle = lineas.map((l) => ({
      pedidoId: l.pedidoId,
      folio: l.folio,
      clienteNombre: l.clienteNombre,
      vendedorId: l.vendedorId,
      vendedorNombre: l.vendedorNombre,
      fechaLiquidacion: l.fechaLiquidacion,
      baseCentavos: numericACentavos(l.base),
      pct: l.pct,
      montoCentavos: numericACentavos(l.monto),
    }));
    const vigentes = await db
      .select()
      .from(pagoComision)
      .where(and(eq(pagoComision.corteId, corte.id), isNull(pagoComision.anuladoAt)));
    for (const p of vigentes)
      pagos.set(p.vendedorId, {
        id: p.id,
        fecha: p.fecha,
        metodo: p.metodo,
        nota: p.nota,
        montoCentavos: numericACentavos(p.monto),
      });
  } else {
    if (mes !== (o.abierto ?? (await calcularMesAbierto(db, hoy))))
      throw new ErrorNegocio('no_encontrado', 'Ese mes no tiene cierre.');
    const filas = await consultaElegibles(db, finDeMes(mes), { bloquear: false, vendedorId: o.vendedorId });
    detalle = filas.map((f) => ({
      pedidoId: f.pedidoId,
      folio: f.folio,
      clienteNombre: f.clienteNombre,
      vendedorId: f.vendedorId,
      vendedorNombre: f.vendedorNombre,
      fechaLiquidacion: f.fechaLiquidacion,
      baseCentavos: numericACentavos(f.total),
      pct: f.comisionPct,
      montoCentavos: comisionCentavos(numericACentavos(f.total), f.comisionPct),
    }));
  }
  const vendedoras = armar(detalle, pagos, !!corte);
  if (o.vendedorId && !vendedoras.length) {
    const [v] = await db
      .select({ nombre: vendedor.nombre })
      .from(vendedor)
      .where(eq(vendedor.id, o.vendedorId));
    if (!v) throw new ErrorNegocio('no_encontrado', 'La vendedora no existe.');
    vendedoras.push({
      vendedorId: o.vendedorId,
      vendedorNombre: v.nombre,
      pedidos: 0,
      baseCentavos: 0,
      comisionCentavos: 0,
      pct: null,
      pedidosDetalle: [],
      pago: null,
      estadoPago: corte ? 'sin_comision' : 'estimado',
    });
  }
  const cerrable = !corte && mesCerrable(mes, hoy);
  return {
    mes,
    nombre: nombreMes(mes),
    corteId: corte?.id ?? null,
    cerrado: !!corte,
    cerradoAt: corte ? corte.cerradoAt.toISOString() : null,
    cerrable,
    motivoNoCerrable: corte || cerrable ? null : mensajeNoTerminado(mes),
    vendedoras,
    totalCentavos: vendedoras.reduce((s, v) => s + v.comisionCentavos, 0),
    numPedidos: vendedoras.reduce((s, v) => s + v.pedidos, 0),
  };
}

/** Cortes cerrados donde la vendedora tiene comisión > 0 y ningún pago vigente. */
export async function pendientesDeVendedora(
  db: Ejecutor,
  vendedorId: string,
): Promise<{ mes: string; nombre: string; montoCentavos: number }[]> {
  const r = await db.execute<{ mes: string; monto: string }>(sql`
    SELECT c.mes::text AS mes, sum(l.monto)::text AS monto
      FROM corte_comision c
      JOIN comision_linea l ON l.corte_id = c.id AND l.vendedor_id = ${vendedorId}
     WHERE NOT EXISTS (SELECT 1 FROM pago_comision p
                        WHERE p.corte_id = c.id AND p.vendedor_id = ${vendedorId} AND p.anulado_at IS NULL)
     GROUP BY c.mes
    HAVING sum(l.monto) > 0
     ORDER BY c.mes`);
  return r.rows.map((x) => ({
    mes: x.mes,
    nombre: nombreMes(x.mes),
    montoCentavos: numericACentavos(x.monto),
  }));
}
