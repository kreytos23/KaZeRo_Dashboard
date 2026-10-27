/**
 * Única parte de la importación que toca la BD. `simular` lee en una transacción de solo lectura;
 * `ensayo` y `aplicar` corren UNA transacción del dueño: timeouts → admin «migración» + auditoría → plan →
 * bloqueos en el orden D-10 (cliente → pedido → piezas) → plan otra vez bajo los bloqueos (su hash debe ser el
 * aprobado) → inserción como `crearPedido` (helpers de comun.ts) → verificación → secuencia de folios → COMMIT
 * (`aplicar`) o ROLLBACK intencional (`ensayo`).
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { conDbUrl, type Ejecutor } from '../../src/db/pool';
import {
  cliente,
  movimientoPieza,
  origenExcel,
  pedido,
  pedidoItem,
  pieza,
  vendedor,
} from '../../src/db/schema';
import { normalizarCodigo } from '../../src/domain/codigos';
import { centavosANumeric, numericACentavos } from '../../src/domain/dinero';
import { pctBpsANumeric } from '../../src/domain/pedidos';
import { fijarContextoAuditoria } from '../../src/server/auditoria/servicio';
import { apartarPiezas, bloquearPiezasPorCodigo, type PiezaBloqueada } from '../../src/server/pedidos/comun';
import { asegurarAdminMigracion } from '../migrar-excel/aplicar';
import { parsearNota } from './parsear';
import { claveNota, planificar } from './planificar';
import {
  LOTE_KZR,
  HOJA_KZR,
  MOTIVO_KZR,
  type FilaExcel,
  type NotaNueva,
  type PlanKzr,
  type Snapshot,
} from './tipos';

/** Hay errores en el plan: no se escribe nada. */
export class ErrorPlanConErrores extends Error {
  override name = 'ErrorPlanConErrores';
  constructor(readonly plan: PlanKzr) {
    super(`El plan tiene ${plan.errores.length} error(es): no se escribió nada.`);
  }
}
/** La BD o el Excel ya no dan el plan aprobado (hash distinto): ROLLBACK. */
export class ErrorPlanCambio extends Error {
  override name = 'ErrorPlanCambio';
  constructor(
    readonly esperado: string,
    readonly calculado: string,
  ) {
    super('El plan cambió desde el aprobado (el Excel o la BD son otros). ROLLBACK: no quedó nada.');
  }
}
export class ErrorVerificacionKzr extends Error {
  override name = 'ErrorVerificacionKzr';
  constructor(readonly diferencias: string[]) {
    super(`La verificación no cuadra (${diferencias.length} diferencia(s)); se hizo ROLLBACK.`);
  }
}
class RollbackIntencional extends Error {
  constructor(readonly resultado: ResultadoKzr) {
    super('Ensayo: ROLLBACK intencional');
  }
}

export interface ResultadoKzr {
  modo: 'ensayo' | 'aplicar';
  plan: PlanKzr;
  insertados: {
    pedidos: number;
    items: number;
    piezasApartadas: number;
    movimientos: number;
    origen: number;
  };
  yaAplicadas: number;
  verificacion: { ok: boolean; diferencias: string[] };
  /** Siguiente folio que entrega la secuencia (en `ensayo`, el esperado: setval no se deshace con ROLLBACK). */
  siguienteFolio: number;
}

/** Lee de la BD lo que el plan necesita para las filas dadas (códigos, folios y claves del Excel). */
export async function cargarSnapshot(tx: Ejecutor, filas: readonly FilaExcel[]): Promise<Snapshot> {
  const codigos = [...new Set(filas.flatMap((f) => (f.id ? [normalizarCodigo(f.id)] : [])))];
  const folios = [...new Set(filas.flatMap((f) => parsearNota(f.nota) ?? []))];
  const claves = folios.map(claveNota);
  const [clientes, vendedores, piezas, pedidosPorFolio, origenes, tarjetas, max, seq] = await Promise.all([
    tx.select({ id: cliente.id, nombre: cliente.nombre }).from(cliente),
    tx.select({ id: vendedor.id, nombre: vendedor.nombre, activo: vendedor.activo }).from(vendedor),
    codigos.length
      ? tx
          .select({
            id: pieza.id,
            codigo: pieza.codigo,
            descripcion: pieza.descripcion,
            estado: pieza.estado,
            exhibidorId: pieza.exhibidorId,
            vendedorCustodiaId: pieza.vendedorCustodiaId,
            precio: pieza.precio,
          })
          .from(pieza)
          .where(inArray(pieza.codigo, codigos))
      : [],
    folios.length
      ? tx.select({ folio: pedido.folio, id: pedido.id }).from(pedido).where(inArray(pedido.folio, folios))
      : [],
    claves.length
      ? tx
          .select({
            lote: origenExcel.lote,
            clave: origenExcel.clave,
            hash: origenExcel.hashContenido,
            pedidoId: origenExcel.pedidoId,
          })
          .from(origenExcel)
          .where(inArray(origenExcel.clave, claves))
      : [],
    tx
      .select({ clienteId: pedido.clienteId, ciclo: pedido.cicloTarjeta, posicion: pedido.posicionTarjeta })
      .from(pedido)
      .where(sql`${pedido.cuentaTarjeta} AND ${pedido.estado} <> 'cancelado'`),
    tx.execute(sql`SELECT coalesce(max(folio), 0)::int AS m FROM pedido`),
    tx.execute(sql`SELECT CASE WHEN is_called THEN last_value ELSE 0 END::int AS v FROM pedido_folio_seq`),
  ]);
  return {
    clientes,
    vendedores,
    piezas: piezas.map((p) => ({ ...p, precioCentavos: numericACentavos(p.precio) })),
    pedidosPorFolio,
    origenes,
    tarjetas: tarjetas.map((t) => ({ clienteId: t.clienteId, ciclo: t.ciclo!, posicion: t.posicion! })),
    maxFolio: (max.rows[0] as { m: number }).m,
    folioSecuencia: (seq.rows[0] as { v: number }).v,
  };
}

async function contarPedidos(tx: Ejecutor): Promise<number> {
  return (await tx.execute(sql`SELECT count(*)::int AS c FROM pedido`)).rows[0]!.c as number;
}

/** `simular`: transacción de SOLO LECTURA; no escribe nada, ni siquiera el admin de migración. */
export function simular(url: string, filas: readonly FilaExcel[], hoy: string): Promise<PlanKzr> {
  return conDbUrl(url, (db) =>
    db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
        return planificar(filas, await cargarSnapshot(tx, filas), hoy);
      },
      { accessMode: 'read only' },
    ),
  );
}

/** Setval nunca baja la secuencia: sigue al mayor entre los pedidos y lo ya entregado. Devuelve el siguiente folio. */
async function fijarSecuenciaFolio(tx: Ejecutor): Promise<number> {
  await tx.execute(sql`
    WITH m AS (
      SELECT GREATEST(
        (SELECT coalesce(max(folio), 0) FROM pedido),
        (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM pedido_folio_seq)
      )::int AS v)
    SELECT CASE WHEN v >= 1 THEN setval(pg_get_serial_sequence('pedido', 'folio'), v, true) ELSE 0 END AS s, v
    FROM m`);
  const [s] = (await tx.execute(sql`SELECT last_value::text AS lv, is_called FROM pedido_folio_seq`))
    .rows as {
    lv: string;
    is_called: boolean;
  }[];
  return Number(s!.lv) + (s!.is_called ? 1 : 0);
}

async function insertarNota(
  tx: Ejecutor,
  n: NotaNueva,
  piezas: PiezaBloqueada[],
  adminId: string,
): Promise<{ pedidoId: string; items: number; movimientos: number }> {
  const [p] = await tx
    .insert(pedido)
    .values({
      folio: n.folio,
      clienteId: n.clienteId,
      vendedorId: n.vendedorId,
      fecha: n.fecha,
      cuentaTarjeta: true,
      cicloTarjeta: n.ciclo,
      posicionTarjeta: n.posicion,
      descuentoLealtadPct: pctBpsANumeric(n.pctBps),
      sinLealtadMotivo: null,
      descuentoManualMonto: centavosANumeric(0),
      descuentoManualMotivo: null,
      total: centavosANumeric(n.total),
      notas: '',
      adminId,
    })
    .returning({ id: pedido.id });
  const pedidoId = p!.id;
  await tx.insert(pedidoItem).values(
    n.items.map((i) => ({
      pedidoId,
      piezaId: i.piezaId,
      precioLista: centavosANumeric(i.precioCentavos),
      precioFinal: centavosANumeric(i.precioFinalCentavos),
    })),
  );
  await apartarPiezas(tx, { pedidoId, piezas, adminId });
  return { pedidoId, items: n.items.length, movimientos: piezas.length };
}

/** Compara lo escrito con el plan (misma transacción, antes del COMMIT). */
async function verificar(
  tx: Ejecutor,
  nuevas: NotaNueva[],
  pedidoIds: Map<number, string>,
  antes: { pedidos: number },
): Promise<string[]> {
  const dif: string[] = [];
  if (!nuevas.length) return dif;
  const ids = [...pedidoIds.values()];
  const filas = await tx.select().from(pedido).where(inArray(pedido.id, ids));
  const items = await tx
    .select({
      pedidoId: pedidoItem.pedidoId,
      piezaId: pedidoItem.piezaId,
      final: pedidoItem.precioFinal,
      estado: pieza.estado,
    })
    .from(pedidoItem)
    .innerJoin(pieza, eq(pieza.id, pedidoItem.piezaId))
    .where(inArray(pedidoItem.pedidoId, ids));
  const mov = await tx
    .select({ pedidoId: movimientoPieza.pedidoId })
    .from(movimientoPieza)
    .where(inArray(movimientoPieza.pedidoId, ids));
  const org = await tx
    .select({ clave: origenExcel.clave })
    .from(origenExcel)
    .where(inArray(origenExcel.pedidoId, ids));
  const c = await contarPedidos(tx);
  if (c !== antes.pedidos + nuevas.length)
    dif.push(`pedidos: esperados ${antes.pedidos + nuevas.length}, hay ${c}`);
  for (const n of nuevas) {
    const f = filas.find((x) => x.id === pedidoIds.get(n.folio));
    const its = items.filter((i) => i.pedidoId === pedidoIds.get(n.folio));
    const k = `KZR-${n.folio}`;
    if (!f) {
      dif.push(`${k}: no existe`);
      continue;
    }
    if (f.folio !== n.folio) dif.push(`${k}: folio ${f.folio}`);
    if (f.estado !== 'abierto') dif.push(`${k}: estado ${f.estado}`);
    if (f.clienteId !== n.clienteId || f.vendedorId !== n.vendedorId)
      dif.push(`${k}: cliente o vendedora distintos`);
    if (f.cicloTarjeta !== n.ciclo || f.posicionTarjeta !== n.posicion)
      dif.push(`${k}: lugar de la tarjeta distinto`);
    if (numericACentavos(f.total) !== n.total) dif.push(`${k}: total distinto`);
    if (f.descuentoLealtadPct !== pctBpsANumeric(n.pctBps)) dif.push(`${k}: descuento de lealtad distinto`);
    if (f.fecha !== n.fecha) dif.push(`${k}: fecha distinta`);
    if (its.length !== n.items.length)
      dif.push(`${k}: ${its.length} línea(s), se esperaban ${n.items.length}`);
    if (its.reduce((a, i) => a + numericACentavos(i.final), 0) !== n.total)
      dif.push(`${k}: las líneas no suman el total`);
    if (its.some((i) => i.estado !== 'apartada')) dif.push(`${k}: hay piezas que no quedaron apartadas`);
    if (mov.filter((m) => m.pedidoId === f.id).length !== n.items.length)
      dif.push(`${k}: movimientos distintos a las líneas`);
    if (!org.some((o) => o.clave === n.clave)) dif.push(`${k}: sin origen_excel`);
  }
  return dif;
}

/** Orden de bloqueo D-10: clientes (no key update, por id) → tabla pedido (nadie más crea folios) → piezas por id. */
async function bloquear(tx: Ejecutor, plan: PlanKzr): Promise<void> {
  const nuevas = plan.notas.filter((n): n is NotaNueva => n.estado === 'nueva');
  const clientes = [...new Set(nuevas.map((n) => n.clienteId))];
  if (clientes.length)
    await tx
      .select({ id: cliente.id })
      .from(cliente)
      .where(inArray(cliente.id, clientes))
      .orderBy(asc(cliente.id))
      .for('no key update');
  await tx.execute(sql`LOCK TABLE pedido IN SHARE ROW EXCLUSIVE MODE`);
}

export async function aplicarKzr(
  url: string,
  filas: readonly FilaExcel[],
  o: { modo: 'ensayo' | 'aplicar'; hoy: string; hashEsperado?: string },
): Promise<ResultadoKzr> {
  try {
    return await conDbUrl(url, (db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
        const adminId = await asegurarAdminMigracion(tx);
        await fijarContextoAuditoria(tx, { adminId, motivo: MOTIVO_KZR });
        // 1) Primera pasada solo para saber qué bloquear; 2) bloqueos; 3) el plan definitivo, ya bajo los bloqueos.
        const previo = planificar(filas, await cargarSnapshot(tx, filas), o.hoy);
        if (previo.errores.length) throw new ErrorPlanConErrores(previo);
        await bloquear(tx, previo);
        const nuevasPrevias = previo.notas.filter((n): n is NotaNueva => n.estado === 'nueva');
        const codigos = nuevasPrevias.flatMap((n) => n.items.map((i) => i.codigo));
        const bloqueadas = await bloquearPiezasPorCodigo(tx, codigos);
        const snap = await cargarSnapshot(tx, filas);
        const plan = planificar(filas, snap, o.hoy);
        if (plan.errores.length) throw new ErrorPlanConErrores(plan);
        if (o.hashEsperado !== undefined && o.hashEsperado !== plan.hash)
          throw new ErrorPlanCambio(o.hashEsperado, plan.hash);

        const nuevas = plan.notas.filter((n): n is NotaNueva => n.estado === 'nueva');
        const porId = new Map(bloqueadas.piezas.map((p) => [p.id, p]));
        const pedidosAntes = await contarPedidos(tx);
        const pedidoIds = new Map<number, string>();
        const ins = { pedidos: 0, items: 0, piezasApartadas: 0, movimientos: 0, origen: 0 };
        for (const n of nuevas) {
          const piezas = n.items.map((i) => porId.get(i.piezaId)!);
          const r = await insertarNota(tx, n, piezas, adminId);
          pedidoIds.set(n.folio, r.pedidoId);
          ins.pedidos++;
          ins.items += r.items;
          ins.piezasApartadas += piezas.length;
          ins.movimientos += r.movimientos;
        }
        if (nuevas.length) {
          const r = await tx
            .insert(origenExcel)
            .values(
              nuevas.map((n) => ({
                lote: LOTE_KZR,
                clave: n.clave,
                hoja: HOJA_KZR,
                filas: n.filas,
                hashContenido: n.hashFuente,
                // Sin nombres: ids de piezas y lugar de la tarjeta; el cliente y la vendedora van en las FK del pedido.
                datos: {
                  folio: n.folio,
                  piezas: n.items.map((i) => i.codigo),
                  tarjeta: { ciclo: n.ciclo, posicion: n.posicion },
                },
                pedidoId: pedidoIds.get(n.folio)!,
              })),
            )
            .returning({ x: sql`1` });
          ins.origen = r.length;
        }
        const diferencias = await verificar(tx, nuevas, pedidoIds, { pedidos: pedidosAntes });
        // El siguiente folio esperado: el mayor entre los pedidos y lo ya entregado, más uno.
        const m = (await tx.execute(sql`SELECT coalesce(max(folio), 0)::int AS m FROM pedido`)).rows[0]!
          .m as number;
        const esperado = Math.max(m, snap.folioSecuencia) + 1;
        const resultado: ResultadoKzr = {
          modo: o.modo,
          plan,
          insertados: ins,
          yaAplicadas: plan.notas.length - nuevas.length,
          verificacion: { ok: diferencias.length === 0, diferencias },
          siguienteFolio: esperado,
        };
        if (diferencias.length) throw new ErrorVerificacionKzr(diferencias);
        // setval no se deshace con ROLLBACK: solo en `aplicar`, ya con todo verificado.
        if (o.modo === 'ensayo') throw new RollbackIntencional(resultado);
        const deLaSecuencia = await fijarSecuenciaFolio(tx);
        if (deLaSecuencia !== esperado)
          throw new ErrorVerificacionKzr([
            `siguiente folio: esperado ${esperado}, la secuencia entrega ${deLaSecuencia}`,
          ]);
        return resultado;
      }),
    );
  } catch (e) {
    if (e instanceof RollbackIntencional) return e.resultado;
    throw e;
  }
}
