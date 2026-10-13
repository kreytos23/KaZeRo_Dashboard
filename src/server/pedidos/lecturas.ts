import { and, asc, desc, eq, gt, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { vAplicacionPago, vCliente, vPedido, vPedidoItem, vPieza, vSaldoFavor } from '@/db/schema';
import { normalizarCodigo } from '@/domain/codigos';
import { armarTarjeta, descuentoLealtad, siguientePosicion, type CicloTarjeta } from '@/domain/lealtad';
import { parsearFechaISO } from '@/domain/fechas';
import { MAX_PIEZAS_PEDIDO, parsearFolio } from '@/domain/pedidos';
import { escaparLike, normalizar } from '@/domain/texto';
import type { PreviaPedido } from '@/features/pedidos/tipos';
import { ErrorNegocio } from '@/server/errores';
import { foliosConSaldo, type EstadoPedido } from './comun';

const filaPedido = {
  id: vPedido.id,
  folio: vPedido.folio,
  fecha: vPedido.fecha,
  estado: vPedido.estado,
  clienteId: vPedido.clienteId,
  clienteNombre: vPedido.clienteNombre,
  vendedorNombre: vPedido.vendedorNombre,
  total: vPedido.total,
  saldo: vPedido.saldo,
  piezas: vPedido.piezas,
  posicionTarjeta: vPedido.posicionTarjeta,
};
export type PedidoFila = {
  id: string;
  folio: number;
  fecha: string;
  estado: EstadoPedido;
  clienteId: string;
  clienteNombre: string;
  vendedorNombre: string;
  total: string;
  saldo: string;
  piezas: number;
  posicionTarjeta: number | null;
};

export async function previsualizarPedido(
  db: Ejecutor,
  o: { clienteId: string | null; codigos: string[]; cuentaTarjeta: boolean },
): Promise<PreviaPedido> {
  const codigos = [...new Set(o.codigos.map(normalizarCodigo).filter(Boolean))].slice(0, MAX_PIEZAS_PEDIDO);
  const [piezas, apartadas, clientes, ocupadas, conSaldo] = await Promise.all([
    codigos.length
      ? db
          .select({
            id: vPieza.id,
            codigo: vPieza.codigo,
            descripcion: vPieza.descripcion,
            precio: vPieza.precio,
            estado: vPieza.estado,
            imagenClave: vPieza.imagenClave,
          })
          .from(vPieza)
          .where(inArray(vPieza.codigo, codigos))
      : [],
    codigos.length
      ? db
          .select({ codigo: vPedidoItem.codigo, folio: vPedidoItem.folio })
          .from(vPedidoItem)
          .where(and(inArray(vPedidoItem.codigo, codigos), eq(vPedidoItem.vigente, true)))
      : [],
    o.clienteId
      ? db
          .select({
            id: vCliente.id,
            nombre: vCliente.nombre,
            vendedorHabitualId: vCliente.vendedorHabitualId,
          })
          .from(vCliente)
          .where(eq(vCliente.id, o.clienteId))
          .limit(1)
      : [],
    o.clienteId && o.cuentaTarjeta
      ? db
          .select({ ciclo: vPedido.cicloTarjeta, posicion: vPedido.posicionTarjeta })
          .from(vPedido)
          .where(
            and(
              eq(vPedido.clienteId, o.clienteId),
              eq(vPedido.cuentaTarjeta, true),
              ne(vPedido.estado, 'cancelado'),
            ),
          )
      : [],
    o.clienteId ? foliosConSaldo(db, o.clienteId) : [],
  ]);
  const porCodigo = new Map(piezas.map((p) => [p.codigo, p]));
  const folioDe = new Map(apartadas.map((a) => [a.codigo, a.folio]));
  const cliente = clientes[0] ?? null;
  let tarjeta: PreviaPedido['tarjeta'] = null;
  if (cliente && o.cuentaTarjeta) {
    const pos = siguientePosicion(ocupadas.map((x) => ({ ciclo: x.ciclo!, posicion: x.posicion! })));
    const l = descuentoLealtad({
      cuentaTarjeta: true,
      posicion: pos.posicion,
      otraNotaConSaldo: conSaldo.length > 0,
    });
    tarjeta = { ...pos, pctBps: l.pctBps, sinLealtad: l.sinLealtad, foliosConSaldo: conSaldo };
  }
  return {
    piezas: codigos.flatMap((c) => {
      const p = porCodigo.get(c);
      if (!p) return [];
      return [
        {
          ...p,
          disponible: p.estado === 'disponible' || p.estado === 'en_exhibidor',
          folioApartada: folioDe.get(c) ?? null,
        },
      ];
    }),
    faltantes: codigos.filter((c) => !porCodigo.has(c)),
    cliente,
    tarjeta,
  };
}

/** Tres consultas fijas. */
export async function obtenerPedidoPorFolio(db: Ejecutor, folio: number) {
  const [p] = await db.select().from(vPedido).where(eq(vPedido.folio, folio)).limit(1);
  if (!p) return null;
  const [items, pagos] = await Promise.all([
    db
      .select({
        id: vPedidoItem.id,
        codigo: vPedidoItem.codigo,
        descripcion: vPedidoItem.descripcion,
        precioLista: vPedidoItem.precioLista,
        precioFinal: vPedidoItem.precioFinal,
        vigente: vPedidoItem.vigente,
        quitadoAt: vPedidoItem.quitadoAt,
        piezaEstado: vPedidoItem.piezaEstado,
      })
      .from(vPedidoItem)
      .where(eq(vPedidoItem.pedidoId, p.id))
      .orderBy(asc(vPedidoItem.codigo)),
    db
      .select()
      .from(vAplicacionPago)
      .where(eq(vAplicacionPago.pedidoId, p.id))
      .orderBy(asc(vAplicacionPago.createdAt)),
  ]);
  return { ...p, items, pagos };
}
export type FichaPedido = NonNullable<Awaited<ReturnType<typeof obtenerPedidoPorFolio>>>;

export interface FiltrosPedidos {
  q?: string;
  estado?: EstadoPedido;
  vendedorId?: string;
  clienteId?: string;
  conSaldo?: boolean;
  /** Fecha del pedido, inclusive, YYYY-MM-DD (calendario real). */
  desde?: string;
  hasta?: string;
  limite?: number;
  offset?: number;
}

function fechaFiltro(t: string | undefined, campo: 'desde' | 'hasta'): string | undefined {
  if (t === undefined || t === '') return undefined;
  const f = parsearFechaISO(t);
  if (!f) throw new ErrorNegocio('fecha_invalida', `La fecha «${campo}» no es válida (AAAA-MM-DD).`, campo);
  return f;
}

export async function listarPedidos(db: Ejecutor, f: FiltrosPedidos = {}): Promise<PedidoFila[]> {
  const desde = fechaFiltro(f.desde, 'desde');
  const hasta = fechaFiltro(f.hasta, 'hasta');
  const q = normalizar(f.q ?? '');
  const folio = f.q ? parsearFolio(f.q) : null;
  const porNombre = q
    ? sql`kz_normalizar(${vPedido.clienteNombre}) LIKE ${'%' + escaparLike(q) + '%'} ESCAPE '\\'`
    : undefined;
  return db
    .select(filaPedido)
    .from(vPedido)
    .where(
      and(
        folio !== null
          ? or(eq(vPedido.folio, folio), sql`${vPedido.folio}::text LIKE ${String(folio) + '%'}`, porNombre)
          : porNombre,
        f.estado ? eq(vPedido.estado, f.estado) : undefined,
        f.vendedorId ? eq(vPedido.vendedorId, f.vendedorId) : undefined,
        f.clienteId ? eq(vPedido.clienteId, f.clienteId) : undefined,
        f.conSaldo ? and(eq(vPedido.estado, 'abierto'), gt(vPedido.saldo, '0')) : undefined,
        desde ? gte(vPedido.fecha, desde) : undefined,
        hasta ? lte(vPedido.fecha, hasta) : undefined,
      ),
    )
    .orderBy(desc(vPedido.folio))
    .limit(Math.min(Math.max(Math.trunc(f.limite ?? 50), 1), 200))
    .offset(Math.max(Math.trunc(f.offset ?? 0), 0));
}

/** Cuatro consultas en paralelo, sin importar cuántos pedidos tenga el cliente. */
export async function resumenCliente(db: Ejecutor, clienteId: string) {
  const [pedidos, pendiente, favor, tarjeta] = await Promise.all([
    listarPedidos(db, { clienteId, limite: 50 }),
    db
      .select({ s: sql<string>`coalesce(sum(${vPedido.saldo}), 0)::numeric(12,2)::text` })
      .from(vPedido)
      .where(and(eq(vPedido.clienteId, clienteId), eq(vPedido.estado, 'abierto'))),
    db.select({ saldo: vSaldoFavor.saldo }).from(vSaldoFavor).where(eq(vSaldoFavor.clienteId, clienteId)),
    db
      .select({
        ciclo: vPedido.cicloTarjeta,
        posicion: vPedido.posicionTarjeta,
        estado: vPedido.estado,
        folio: vPedido.folio,
      })
      .from(vPedido)
      .where(
        and(
          eq(vPedido.clienteId, clienteId),
          eq(vPedido.cuentaTarjeta, true),
          ne(vPedido.estado, 'cancelado'),
        ),
      ),
  ]);
  return {
    pedidos,
    saldoPendiente: pendiente[0]!.s,
    saldoFavor: favor[0]?.saldo ?? '0.00',
    tarjeta: armarTarjeta(
      tarjeta.map((t) => ({
        ciclo: t.ciclo!,
        posicion: t.posicion!,
        estado: t.estado as 'abierto' | 'liquidado',
        folio: t.folio,
      })),
    ) as CicloTarjeta[],
  };
}

export async function saldoFavorDeVendedor(db: Ejecutor, vendedorId: string): Promise<string> {
  const [f] = await db
    .select({ saldo: vSaldoFavor.saldo })
    .from(vSaldoFavor)
    .where(eq(vSaldoFavor.vendedorId, vendedorId));
  return f?.saldo ?? '0.00';
}

export function apartadasDeExhibidor(db: Ejecutor, exhibidorId: string) {
  return db
    .select({
      codigo: vPedidoItem.codigo,
      descripcion: vPedidoItem.descripcion,
      folio: vPedidoItem.folio,
      clienteNombre: vPedidoItem.clienteNombre,
    })
    .from(vPedidoItem)
    .where(
      and(
        eq(vPedidoItem.exhibidorId, exhibidorId),
        eq(vPedidoItem.vigente, true),
        eq(vPedidoItem.piezaEstado, 'apartada'),
      ),
    )
    .orderBy(asc(vPedidoItem.codigo));
}
