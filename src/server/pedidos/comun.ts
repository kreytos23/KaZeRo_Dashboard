import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { aplicacionPago, cliente, exhibidor, movimientoPieza, pedido, pedidoItem, pieza } from '@/db/schema';
import { normalizarCodigo } from '@/domain/codigos';
import { numericACentavos } from '@/domain/dinero';
import { MAX_PIEZAS_PEDIDO, formatoFolio } from '@/domain/pedidos';
import { ErrorNegocio } from '@/server/errores';
import { MSG_EXHIBIDOR_CERRADO } from '@/server/exhibidores/mensajes';
import type { EstadoPieza } from '@/server/piezas/servicio';

export type EstadoPedido = (typeof pedido.$inferSelect)['estado'];
export interface PiezaBloqueada {
  id: string;
  codigo: string;
  estado: EstadoPieza;
  exhibidorId: string | null;
  /** Plan 3.1: vendedora que la tiene en su poder (solo disponible o apartada). */
  vendedorCustodiaId: string | null;
  precio: string;
}

const columnasPieza = {
  id: pieza.id,
  codigo: pieza.codigo,
  estado: pieza.estado,
  exhibidorId: pieza.exhibidorId,
  vendedorCustodiaId: pieza.vendedorCustodiaId,
  precio: pieza.precio,
};

/** Normaliza y valida antes de tocar la BD: sin vacíos ni repetidos, con tope. */
export function validarCodigos(codigos: readonly string[], { minimo = 1 } = {}): string[] {
  const lista = codigos.map(normalizarCodigo);
  if (lista.some((c) => !c)) throw new ErrorNegocio('codigo_vacio', 'Hay un código vacío.', 'codigos');
  if (lista.length < minimo) throw new ErrorNegocio('sin_piezas', 'Agrega al menos una pieza.', 'codigos');
  if (lista.length > MAX_PIEZAS_PEDIDO)
    throw new ErrorNegocio('demasiadas_piezas', `Máximo ${MAX_PIEZAS_PEDIDO} piezas por pedido.`, 'codigos');
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const c of lista) (vistos.has(c) ? repetidos : vistos).add(c);
  if (repetidos.size)
    throw new ErrorNegocio(
      'codigos_repetidos',
      `Códigos repetidos: ${[...repetidos].join(', ')}.`,
      'codigos',
    );
  return lista;
}

/** Último eslabón del orden de bloqueo (D-10): piezas por id ascendente. Una consulta. */
export async function bloquearPiezasPorCodigo(
  tx: Ejecutor,
  codigos: string[],
): Promise<{ piezas: PiezaBloqueada[]; faltantes: string[] }> {
  const piezas: PiezaBloqueada[] = codigos.length
    ? await tx
        .select(columnasPieza)
        .from(pieza)
        .where(inArray(pieza.codigo, codigos))
        .orderBy(asc(pieza.id))
        .for('update')
    : [];
  const encontrados = new Set(piezas.map((p) => p.codigo));
  return { piezas, faltantes: codigos.filter((c) => !encontrados.has(c)) };
}

/** Exhibidores por id ascendente con NO KEY UPDATE (no choca con el KEY SHARE de las FK). Devuelve los abiertos. */
export async function bloquearExhibidores(tx: Ejecutor, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const ex = await tx
    .select({ id: exhibidor.id, estado: exhibidor.estado })
    .from(exhibidor)
    .where(inArray(exhibidor.id, ids))
    .orderBy(asc(exhibidor.id))
    .for('no key update');
  return new Set(ex.filter((e) => e.estado === 'abierto').map((e) => e.id));
}

class ExhibidorCambio extends Error {}
const INTENTOS_BLOQUEO = 3;

/**
 * Para apartar (crearPedido) o agregar y quitar a la vez (editarPedido, con agregar ∪ quitar): exhibidores de esas piezas → piezas por id (D-10, Plan 2.1),
 * igual que enviar/regresar, para que ninguna operación de exhibidor espere a una pieza que espera a su exhibidor.
 *
 * El exhibidor se lee sin bloqueo antes de bloquear la pieza; si entre la lectura y el bloqueo la pieza entró a
 * otro exhibidor (enviar concurrente), se deshace el intento (SAVEPOINT: libera sus bloqueos) y se repite en
 * orden. Una pieza solo cambia de exhibidor pasando por NULL (D-11), así que un reintento casi siempre basta.
 */
export async function bloquearPiezasParaApartar(
  tx: Ejecutor,
  codigos: string[],
): Promise<{ piezas: PiezaBloqueada[]; faltantes: string[]; abiertos: Set<string> }> {
  if (!codigos.length) return { piezas: [], faltantes: [], abiertos: new Set() };
  for (let intento = 0; intento < INTENTOS_BLOQUEO; intento++) {
    const previas = await tx
      .select({ exhibidorId: pieza.exhibidorId })
      .from(pieza)
      .where(inArray(pieza.codigo, codigos));
    const exhibidores = [...new Set(previas.flatMap((p) => (p.exhibidorId ? [p.exhibidorId] : [])))];
    try {
      return await tx.transaction(async (sp) => {
        const abiertos = await bloquearExhibidores(sp, exhibidores);
        const r = await bloquearPiezasPorCodigo(sp, codigos);
        if (r.piezas.some((p) => p.exhibidorId !== null && !exhibidores.includes(p.exhibidorId)))
          throw new ExhibidorCambio();
        return { ...r, abiertos };
      });
    } catch (e) {
      if (!(e instanceof ExhibidorCambio)) throw e;
    }
  }
  throw new ErrorNegocio(
    'conflicto_concurrente',
    'Otra operación movió estas piezas al mismo tiempo. Intenta de nuevo.',
    'codigos',
  );
}

/** R-04. Todo o nada: el mensaje lista los códigos en el orden escrito y el folio de las apartadas (R-05). */
export async function exigirDisponibles(
  tx: Ejecutor,
  d: { codigos: string[]; piezas: PiezaBloqueada[]; faltantes: string[]; prefijo: string },
): Promise<void> {
  const orden = new Map(d.codigos.map((c, i) => [c, i]));
  const noDisponibles = d.piezas
    .filter((p) => p.estado !== 'disponible' && p.estado !== 'en_exhibidor')
    .sort((a, b) => orden.get(a.codigo)! - orden.get(b.codigo)!);
  if (!d.faltantes.length && !noDisponibles.length) return;
  const apartadas = noDisponibles.filter((p) => p.estado === 'apartada').map((p) => p.id);
  const folios = new Map(
    apartadas.length
      ? (
          await tx
            .select({ piezaId: pedidoItem.piezaId, folio: pedido.folio })
            .from(pedidoItem)
            .innerJoin(pedido, eq(pedido.id, pedidoItem.pedidoId))
            .where(and(eq(pedidoItem.vigente, true), inArray(pedidoItem.piezaId, apartadas)))
        ).map((f) => [f.piezaId, f.folio] as const)
      : [],
  );
  const partes = [d.prefijo];
  if (d.faltantes.length) partes.push(`No existen: ${d.faltantes.join(', ')}.`);
  if (noDisponibles.length)
    partes.push(
      `No están disponibles: ${noDisponibles
        .map((p) =>
          folios.has(p.id)
            ? `${p.codigo} (apartada en ${formatoFolio(folios.get(p.id)!)})`
            : `${p.codigo} (${p.estado})`,
        )
        .join(', ')}.`,
    );
  throw new ErrorNegocio('piezas_no_disponibles', partes.join(' '), 'codigos');
}

/**
 * disponible | en_exhibidor → apartada. exhibidor_id se conserva (para regresar si se cancela). Las piezas YA
 * están bloqueadas: el UPDATE va antes que sus movimientos (trigger movimiento_pieza_coherente).
 */
export async function apartarPiezas(
  tx: Ejecutor,
  { pedidoId, piezas, adminId }: { pedidoId: string; piezas: PiezaBloqueada[]; adminId: string },
): Promise<void> {
  if (!piezas.length) return;
  await tx
    .update(pieza)
    .set({ estado: 'apartada', version: sql`${pieza.version} + 1` })
    .where(
      inArray(
        pieza.id,
        piezas.map((p) => p.id),
      ),
    );
  await tx.insert(movimientoPieza).values(
    piezas.map((p) => ({
      piezaId: p.id,
      tipo: 'apartado' as const,
      deEstado: p.estado,
      aEstado: 'apartada' as const,
      exhibidorId: p.exhibidorId,
      vendedorId: p.vendedorCustodiaId,
      pedidoId,
      adminId,
    })),
  );
}

/**
 * Primer paso para liberar (D-10): bloquea, por id, los exhibidores de esas piezas y devuelve los ABIERTOS.
 * El exhibidor de una pieza apartada no puede cambiar (trigger, D-11): leerlo antes de bloquear la pieza es seguro.
 * NO KEY UPDATE, igual que enviar/regresar (Plan 2): no choca con el KEY SHARE de las FK de movimiento_pieza.
 */
export async function bloquearExhibidoresDe(tx: Ejecutor, piezaIds: string[]): Promise<Set<string>> {
  if (!piezaIds.length) return new Set();
  const previas = await tx
    .select({ exhibidorId: pieza.exhibidorId })
    .from(pieza)
    .where(inArray(pieza.id, piezaIds));
  return bloquearExhibidores(tx, [
    ...new Set(previas.flatMap((p) => (p.exhibidorId ? [p.exhibidorId] : []))),
  ]);
}

/** Piezas por id ascendente FOR UPDATE, cuando ya se conocen los ids (cancelar). */
export function bloquearPiezasPorId(tx: Ejecutor, ids: string[]): Promise<PiezaBloqueada[]> {
  if (!ids.length) return Promise.resolve([]);
  return tx
    .select(columnasPieza)
    .from(pieza)
    .where(inArray(pieza.id, ids))
    .orderBy(asc(pieza.id))
    .for('update');
}

/**
 * R-17: piezas YA BLOQUEADAS regresan a su estado previo: al exhibidor si sigue abierto (`abiertos`), si no a
 * disponible sin exhibidor (D-12). Separar bloqueo y escritura deja que editarPedido bloquee todas sus piezas
 * (agregar ∪ quitar) en UNA consulta ordenada por id, sin abrir la puerta a interbloqueos.
 */
export async function liberarPiezas(
  tx: Ejecutor,
  d: { pedidoId: string; piezas: PiezaBloqueada[]; abiertos: Set<string>; nota: string; adminId: string },
): Promise<{ alExhibidor: number; aDisponible: number }> {
  if (!d.piezas.length) return { alExhibidor: 0, aDisponible: 0 };
  const noApartadas = d.piezas.filter((p) => p.estado !== 'apartada');
  if (noApartadas.length) throw inconsistente(noApartadas);
  const vuelve = (p: PiezaBloqueada) => p.exhibidorId !== null && d.abiertos.has(p.exhibidorId);
  const alExhibidor = d.piezas.filter(vuelve).map((p) => p.id);
  const aDisponible = d.piezas.filter((p) => !vuelve(p)).map((p) => p.id);
  if (alExhibidor.length)
    await tx
      .update(pieza)
      .set({ estado: 'en_exhibidor', version: sql`${pieza.version} + 1` })
      .where(inArray(pieza.id, alExhibidor));
  if (aDisponible.length)
    await tx
      .update(pieza)
      .set({ estado: 'disponible', exhibidorId: null, version: sql`${pieza.version} + 1` })
      .where(inArray(pieza.id, aDisponible));
  await tx.insert(movimientoPieza).values(
    d.piezas.map((p) => ({
      piezaId: p.id,
      tipo: 'liberacion' as const,
      deEstado: 'apartada' as const,
      aEstado: vuelve(p) ? ('en_exhibidor' as const) : ('disponible' as const),
      exhibidorId: p.exhibidorId,
      vendedorId: p.vendedorCustodiaId, // la apartada conserva su vendedora: vuelve con ella
      pedidoId: d.pedidoId,
      adminId: d.adminId,
      nota: p.exhibidorId && !vuelve(p) ? `${d.nota} El exhibidor está cerrado: queda disponible.` : d.nota,
    })),
  );
  return { alExhibidor: alExhibidor.length, aDisponible: aDisponible.length };
}

/** Piezas de un pedido que ya no están apartadas (datos alterados fuera de los servicios): nombra cuáles. */
function inconsistente(piezas: PiezaBloqueada[]): ErrorNegocio {
  return new ErrorNegocio(
    'inconsistente',
    `Las piezas del pedido ya no están apartadas: ${piezas.map((p) => `${p.codigo} (${p.estado})`).join(', ')}. Recarga la página.`,
  );
}

/** Lo pagado (aplicaciones vigentes) de varios pedidos en una sola agregación; el que no tiene pagos queda en 0. */
export async function pagadoPorPedido(tx: Ejecutor, pedidoIds: string[]): Promise<Map<string, number>> {
  const r = new Map(pedidoIds.map((id) => [id, 0]));
  if (!pedidoIds.length) return r;
  const filas = await tx
    .select({
      pedidoId: aplicacionPago.pedidoId,
      pagado: sql<string>`sum(${aplicacionPago.monto})::numeric(12,2)::text`,
    })
    .from(aplicacionPago)
    .where(and(inArray(aplicacionPago.pedidoId, pedidoIds), isNull(aplicacionPago.anuladaAt)))
    .groupBy(aplicacionPago.pedidoId);
  for (const f of filas) r.set(f.pedidoId, numericACentavos(f.pagado));
  return r;
}

export async function pagadoCentavos(tx: Ejecutor, pedidoId: string): Promise<number> {
  const [f] = await tx
    .select({ pagado: sql<string>`coalesce(sum(${aplicacionPago.monto}), 0)::numeric(12,2)::text` })
    .from(aplicacionPago)
    .where(and(eq(aplicacionPago.pedidoId, pedidoId), isNull(aplicacionPago.anuladaAt)));
  return numericACentavos(f!.pagado);
}

/** Bloquea la clienta (NO KEY UPDATE): serializa su tarjeta de lealtad y sus notas (D-10: primero la clienta). */
export async function bloquearCliente(tx: Ejecutor, clienteId: string): Promise<void> {
  const [c] = await tx
    .select({ id: cliente.id })
    .from(cliente)
    .where(eq(cliente.id, clienteId))
    .for('no key update');
  if (!c) throw new ErrorNegocio('no_encontrado', 'El cliente no existe.', 'clienteId');
}

/** Exhibidor abierto, bloqueado NO KEY UPDATE (como enviar/regresar/cerrar: serializa el dinero y el cierre). */
export async function bloquearExhibidorAbierto(tx: Ejecutor, exhibidorId: string) {
  const [e] = await tx
    .select({ estado: exhibidor.estado, vendedorId: exhibidor.vendedorId })
    .from(exhibidor)
    .where(eq(exhibidor.id, exhibidorId))
    .for('no key update');
  if (!e) throw new ErrorNegocio('no_encontrado', 'El exhibidor no existe.', 'exhibidorId');
  if (e.estado === 'cerrado')
    throw new ErrorNegocio('exhibidor_cerrado', MSG_EXHIBIDOR_CERRADO, 'exhibidorId');
  return e;
}

const columnasPedido = {
  id: pedido.id,
  folio: pedido.folio,
  estado: pedido.estado,
  version: pedido.version,
  clienteId: pedido.clienteId,
  vendedorId: pedido.vendedorId,
  fecha: pedido.fecha,
  total: pedido.total,
  descuentoLealtadPct: pedido.descuentoLealtadPct,
  descuentoManualMonto: pedido.descuentoManualMonto,
  descuentoManualMotivo: pedido.descuentoManualMotivo,
  notas: pedido.notas,
};

/** D-10: cliente → pedido, ambos FOR NO KEY UPDATE. cliente_id no es actualizable (R-27), leerlo antes es seguro. */
export async function bloquearPedido(tx: Ejecutor, pedidoId: string) {
  const [ref] = await tx.select({ clienteId: pedido.clienteId }).from(pedido).where(eq(pedido.id, pedidoId));
  if (!ref) throw new ErrorNegocio('no_encontrado', 'El pedido no existe.');
  await bloquearCliente(tx, ref.clienteId);
  const [p] = await tx
    .select(columnasPedido)
    .from(pedido)
    .where(eq(pedido.id, pedidoId))
    .for('no key update');
  return p!;
}
export type PedidoBloqueado = Awaited<ReturnType<typeof bloquearPedido>>;

/**
 * Varios pedidos por id ascendente, FOR NO KEY UPDATE, en una consulta (D-10). Quien llama YA bloqueó sus clientas
 * (por id, antes). Los que no existen simplemente no vienen: quien llama decide el error.
 */
export function bloquearPedidos(tx: Ejecutor, ids: string[]): Promise<PedidoBloqueado[]> {
  if (!ids.length) return Promise.resolve([]);
  return tx
    .select(columnasPedido)
    .from(pedido)
    .where(inArray(pedido.id, ids))
    .orderBy(asc(pedido.id))
    .for('no key update');
}

/**
 * Piezas vigentes del pedido, bloqueadas en el orden D-10 (exhibidores NO KEY UPDATE por id → piezas FOR UPDATE por id).
 * Las piezas apartadas no cambian de exhibidor (trigger, D-11): leerlo antes de bloquear es seguro.
 * Devuelve también los exhibidores abiertos y las líneas vigentes (para liberar al cancelar).
 */
export async function bloquearPiezasDelPedido(
  tx: Ejecutor,
  pedidoId: string,
): Promise<{ piezas: PiezaBloqueada[]; abiertos: Set<string>; itemIds: string[] }> {
  const items = await tx
    .select({ id: pedidoItem.id, piezaId: pedidoItem.piezaId })
    .from(pedidoItem)
    .where(and(eq(pedidoItem.pedidoId, pedidoId), eq(pedidoItem.vigente, true)));
  const ids = items.map((i) => i.piezaId);
  const abiertos = await bloquearExhibidoresDe(tx, ids);
  return { piezas: await bloquearPiezasPorId(tx, ids), abiertos, itemIds: items.map((i) => i.id) };
}

/**
 * R-15: si el saldo llegó a 0, el pedido se liquida y sus piezas pasan a vendida (exhibidor_id = NULL, D-13).
 * Quien llama ya bloqueó cliente y pedido (y, si las tocó, exhibidores y piezas) y ya fijó el contexto de
 * auditoría (el cambio de estado lo registra kz_auditar). La reusa el Plan 4.
 */
export async function liquidarSiSaldoCero(
  tx: Ejecutor,
  pedidoId: string,
  adminId: string,
): Promise<EstadoPedido> {
  const [p] = await tx
    .select({ estado: pedido.estado, total: pedido.total })
    .from(pedido)
    .where(eq(pedido.id, pedidoId));
  if (!p) throw new ErrorNegocio('no_encontrado', 'El pedido no existe.');
  if (p.estado !== 'abierto' || numericACentavos(p.total) > (await pagadoCentavos(tx, pedidoId)))
    return p.estado;
  // D-10: exhibidores → piezas, siempre, aunque quien llama ya los haya bloqueado (volver a bloquear es inocuo).
  const { piezas } = await bloquearPiezasDelPedido(tx, pedidoId);
  const noApartadas = piezas.filter((x) => x.estado !== 'apartada');
  if (noApartadas.length) throw inconsistente(noApartadas);
  if (piezas.length) {
    await tx
      .update(pieza)
      // D-10 (Plan 3.1): vendida sale también de la custodia de la vendedora (CHECK pieza_custodia_solo_si_aplica).
      .set({
        estado: 'vendida',
        exhibidorId: null,
        vendedorCustodiaId: null,
        version: sql`${pieza.version} + 1`,
      })
      .where(
        inArray(
          pieza.id,
          piezas.map((x) => x.id),
        ),
      );
    await tx.insert(movimientoPieza).values(
      piezas.map((x) => ({
        piezaId: x.id,
        tipo: 'venta' as const,
        deEstado: 'apartada' as const,
        aEstado: 'vendida' as const,
        exhibidorId: x.exhibidorId,
        vendedorId: x.vendedorCustodiaId, // trazabilidad: de quién salió (comisiones, Plan 5)
        pedidoId,
        adminId,
      })),
    );
  }
  await tx
    .update(pedido)
    .set({ estado: 'liquidado', liquidadoAt: sql`now()`, version: sql`${pedido.version} + 1` })
    .where(eq(pedido.id, pedidoId));
  return 'liquidado';
}
