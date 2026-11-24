import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { vExhibidor, vMovimientoPieza, vPedido, vPieza } from '@/db/schema';
import { mesDe, mesSiguiente, type Mes } from '@/domain/comisiones';
import { numericACentavos } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { hojaSale, notasVendidas, piezasAlCierre, type MovExhibidor } from '@/domain/reporte-exhibidor';

export interface HojaExhibidor {
  exhibidorId: string;
  nombre: string;
  vendedorNombre: string;
  piezasAlCierre: { codigo: string; descripcion: string; precioCentavos: number }[];
  ventas: {
    pedidoId: string;
    folio: number;
    fecha: string;
    piezas: number;
    totalCentavos: number;
    cobradoCentavos: number;
    saldoCentavos: number;
    estado: 'abierto' | 'liquidado' | 'cancelado';
  }[];
}

export interface ReporteExhibidores {
  mes: Mes;
  enCurso: boolean;
  /** Fecha de generación (México): la «Fecha de entrega» de la hoja y el corte del mes en curso. */
  hoy: string;
  hojas: HojaExhibidor[];
}

function agrupar<T, K>(filas: readonly T[], llave: (f: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const f of filas) {
    const lista = m.get(llave(f));
    if (lista) lista.push(f);
    else m.set(llave(f), [f]);
  }
  return m;
}

/**
 * Todas las hojas de un mes, en tres consultas como mucho (exhibidores, movimientos y, si hubo ventas, sus notas):
 * una joyería tiene pocos exhibidores y el filtro por exhibidor se hace en quien llama. Sale la hoja con piezas al
 * cierre o, con `ventas`, la que vendió en el mes (`hojaSale`). X-1: columnas explícitas, sin costo ni datos de la
 * clienta.
 */
export async function reporteExhibidores(
  db: Ejecutor,
  o: { mes: Mes; hoy?: string; ventas?: boolean },
): Promise<ReporteExhibidores> {
  const hoy = o.hoy ?? hoyMX();
  const corte = mesSiguiente(o.mes);
  const [exhibidores, movs] = await Promise.all([
    db
      .select({
        id: vExhibidor.id,
        nombre: vExhibidor.nombre,
        vendedorNombre: vExhibidor.vendedorNombre,
      })
      .from(vExhibidor)
      .orderBy(asc(vExhibidor.nombre)),
    db
      .select({
        exhibidorId: vMovimientoPieza.exhibidorId,
        piezaId: vMovimientoPieza.piezaId,
        orden: vMovimientoPieza.orden,
        tipo: vMovimientoPieza.tipo,
        deEstado: vMovimientoPieza.deEstado,
        aEstado: vMovimientoPieza.aEstado,
        pedidoId: vMovimientoPieza.pedidoId,
        dia: sql<string>`to_char(${vMovimientoPieza.fecha} AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD')`,
        codigo: vPieza.codigo,
        descripcion: vPieza.descripcion,
        precio: vPieza.precio,
      })
      .from(vMovimientoPieza)
      .innerJoin(vPieza, eq(vPieza.id, vMovimientoPieza.piezaId))
      .where(
        and(
          isNotNull(vMovimientoPieza.exhibidorId),
          lt(vMovimientoPieza.fecha, sql`(${corte}::date)::timestamp AT TIME ZONE 'America/Mexico_City'`),
        ),
      )
      .orderBy(asc(vMovimientoPieza.orden)),
  ]);

  const movsPorExhibidor = agrupar(movs, (m) => m.exhibidorId!);
  const notasPorExhibidor = new Map(
    exhibidores.map((e) => {
      const propios: MovExhibidor[] = movsPorExhibidor.get(e.id) ?? [];
      return [e.id, notasVendidas(propios, o.mes)] as const;
    }),
  );
  const ids = [...new Set([...notasPorExhibidor.values()].flatMap((n) => [...n.keys()]))];
  const notas = ids.length
    ? await db
        .select({
          id: vPedido.id,
          folio: vPedido.folio,
          fecha: vPedido.fecha,
          total: vPedido.total,
          pagado: vPedido.pagado,
          saldo: vPedido.saldo,
          estado: vPedido.estado,
        })
        .from(vPedido)
        .where(inArray(vPedido.id, ids))
    : [];
  const notaPorId = new Map(notas.map((n) => [n.id, n]));

  const hojas = exhibidores.flatMap((e) => {
    const propios = movsPorExhibidor.get(e.id) ?? [];
    const quedan = new Set(piezasAlCierre(propios, o.mes));
    const vendidas = notasPorExhibidor.get(e.id)!;
    if (!hojaSale({ piezasAlCierre: quedan.size, notasDelMes: vendidas.size, ventas: o.ventas ?? false }))
      return [];
    const datosPieza = new Map(propios.map((m) => [m.piezaId, m]));
    return [
      {
        exhibidorId: e.id,
        nombre: e.nombre,
        vendedorNombre: e.vendedorNombre,
        piezasAlCierre: [...quedan]
          .map((id) => datosPieza.get(id)!)
          .map((m) => ({
            codigo: m.codigo,
            descripcion: m.descripcion,
            precioCentavos: numericACentavos(m.precio),
          }))
          .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es')),
        ventas: [...vendidas]
          .flatMap(([id, n]) => {
            const nota = notaPorId.get(id);
            if (!nota) return [];
            return [
              {
                pedidoId: id,
                folio: nota.folio,
                fecha: nota.fecha,
                piezas: n,
                totalCentavos: numericACentavos(nota.total),
                cobradoCentavos: numericACentavos(nota.pagado),
                saldoCentavos: numericACentavos(nota.saldo),
                estado: nota.estado,
              },
            ];
          })
          .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.folio - b.folio),
      },
    ];
  });
  return { mes: o.mes, enCurso: o.mes >= mesDe(hoy), hoy, hojas };
}
