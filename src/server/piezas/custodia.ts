import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import {
  exhibidor,
  movimientoPieza,
  pedido,
  pedidoItem,
  pieza,
  vPedidoItem,
  vPieza,
  vendedor,
} from '@/db/schema';
import { formatoFolio } from '@/domain/pedidos';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { codigosValidos } from '@/server/exhibidores/servicio';
import type { PiezaBloqueada } from '@/server/pedidos/comun';

/**
 * Plan 3.1, decisión 5: una pieza `disponible` puede estar en poder de una vendedora (`vendedor_custodia_id`).
 * Las reglas viven también en la BD (trigger de pieza v5, CHECK y movimiento coherente de 0017); aquí se
 * validan antes para dar mensajes con los códigos y los nombres.
 *
 * Bloqueo: solo piezas por id (FOR UPDATE). Una pieza `disponible` no tiene exhibidor, así que no hay nada
 * más que bloquear. La fila del vendedor no se bloquea (igual que en exhibidores: una desactivación
 * concurrente puede dejar pasar una entrega, aceptado). Idempotencia natural, como enviar/regresar: repetir
 * la entrega falla con «ya la tiene» y no duplica nada.
 */

const nombresPor = async (tx: Ejecutor, tabla: 'vendedor' | 'exhibidor', ids: string[]) => {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return new Map<string, string>();
  const filas =
    tabla === 'vendedor'
      ? await tx
          .select({ id: vendedor.id, nombre: vendedor.nombre })
          .from(vendedor)
          .where(inArray(vendedor.id, unicos))
      : await tx
          .select({ id: exhibidor.id, nombre: exhibidor.nombre })
          .from(exhibidor)
          .where(inArray(exhibidor.id, unicos));
  return new Map(filas.map((f) => [f.id, f.nombre]));
};

async function bloquearPorCodigo(tx: Ejecutor, codigos: string[]) {
  const piezas = await tx
    .select({
      id: pieza.id,
      codigo: pieza.codigo,
      estado: pieza.estado,
      exhibidorId: pieza.exhibidorId,
      custodia: pieza.vendedorCustodiaId,
    })
    .from(pieza)
    .where(inArray(pieza.codigo, codigos))
    .orderBy(asc(pieza.id))
    .for('update');
  const encontrados = new Set(piezas.map((p) => p.codigo));
  // Los mensajes listan los códigos en el orden en que se escribieron (los ids son uuid aleatorios).
  const orden = new Map(codigos.map((c, i) => [c, i]));
  const porEscritura = <T extends { codigo: string }>(xs: T[]) =>
    [...xs].sort((a, b) => orden.get(a.codigo)! - orden.get(b.codigo)!);
  return { piezas, porEscritura, faltantes: codigos.filter((c) => !encontrados.has(c)) };
}

export async function entregarAVendedora(
  db: Ejecutor,
  d: { adminId: string; vendedorId: string; codigos: string[] },
): Promise<{ entregadas: number }> {
  const codigos = codigosValidos(d.codigos);
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const [v] = await tx
        .select({ nombre: vendedor.nombre, activo: vendedor.activo, tipo: vendedor.tipo })
        .from(vendedor)
        .where(eq(vendedor.id, d.vendedorId));
      if (!v) throw new ErrorNegocio('no_encontrado', 'La vendedora no existe.');
      if (!v.activo) throw new ErrorNegocio('vendedor_inactivo', 'La vendedora está inactiva.');
      if (v.tipo === 'casa')
        throw new ErrorNegocio('vendedor_casa', 'Kazero es la casa: elige una vendedora.');
      const { piezas, porEscritura, faltantes } = await bloquearPorCodigo(tx, codigos);
      // Solo se entrega lo que está disponible en Kazero: sin custodia (y, por tanto, sin exhibidor).
      const noDisponibles = porEscritura(piezas.filter((p) => p.estado !== 'disponible' || p.custodia));
      if (faltantes.length || noDisponibles.length) {
        const partes = ['No se entregó nada.'];
        if (faltantes.length) partes.push(`No existen: ${faltantes.join(', ')}.`);
        if (noDisponibles.length) {
          const [vendedoras, exhibidores] = await Promise.all([
            nombresPor(
              tx,
              'vendedor',
              noDisponibles.flatMap((p) => (p.custodia ? [p.custodia] : [])),
            ),
            nombresPor(
              tx,
              'exhibidor',
              noDisponibles.flatMap((p) => (p.exhibidorId ? [p.exhibidorId] : [])),
            ),
          ]);
          const motivo = (p: (typeof noDisponibles)[number]) => {
            if (p.custodia)
              return p.custodia === d.vendedorId
                ? `ya la tiene ${v.nombre}`
                : `la tiene ${vendedoras.get(p.custodia) ?? 'otra vendedora'}`;
            if (p.estado === 'en_exhibidor')
              return `en exhibidor ${p.exhibidorId ? (exhibidores.get(p.exhibidorId) ?? '') : ''}`.trim();
            return p.estado;
          };
          partes.push(
            `No están disponibles en Kazero: ${noDisponibles.map((p) => `${p.codigo} (${motivo(p)})`).join(', ')}.`,
          );
        }
        throw new ErrorNegocio('entrega_rechazada', partes.join(' '), 'codigos');
      }
      const ids = piezas.map((p) => p.id);
      // El UPDATE va antes que el movimiento (trigger movimiento_pieza_coherente).
      await tx
        .update(pieza)
        .set({ vendedorCustodiaId: d.vendedorId, version: sql`${pieza.version} + 1` })
        .where(inArray(pieza.id, ids));
      await tx.insert(movimientoPieza).values(
        ids.map((piezaId) => ({
          piezaId,
          tipo: 'entrega_vendedora' as const,
          deEstado: 'disponible' as const,
          aEstado: 'disponible' as const,
          vendedorId: d.vendedorId,
          adminId: d.adminId,
        })),
      );
      return { entregadas: ids.length };
    }),
  );
}

export async function regresarAKazero(
  db: Ejecutor,
  d: { adminId: string; vendedorId: string; codigos: string[] },
): Promise<{ regresadas: number }> {
  const codigos = codigosValidos(d.codigos);
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const [v] = await tx
        .select({ nombre: vendedor.nombre })
        .from(vendedor)
        .where(eq(vendedor.id, d.vendedorId));
      if (!v) throw new ErrorNegocio('no_encontrado', 'La vendedora no existe.');
      const { piezas, porEscritura, faltantes } = await bloquearPorCodigo(tx, codigos);
      const suyas = (p: (typeof piezas)[number]) => p.custodia === d.vendedorId;
      const ajenas = porEscritura(piezas.filter((p) => !suyas(p)));
      // Las apartadas no regresan: vuelven al cancelar la nota o salen al venderse.
      const apartadas = porEscritura(piezas.filter((p) => suyas(p) && p.estado !== 'disponible'));
      if (faltantes.length || ajenas.length || apartadas.length) {
        const partes = ['No se regresó nada.'];
        if (faltantes.length) partes.push(`No existen: ${faltantes.join(', ')}.`);
        if (ajenas.length)
          partes.push(`No las tiene ${v.nombre}: ${ajenas.map((p) => p.codigo).join(', ')}.`);
        if (apartadas.length) {
          const folios = new Map(
            (
              await tx
                .select({ piezaId: pedidoItem.piezaId, folio: pedido.folio })
                .from(pedidoItem)
                .innerJoin(pedido, eq(pedido.id, pedidoItem.pedidoId))
                .where(
                  and(
                    eq(pedidoItem.vigente, true),
                    inArray(
                      pedidoItem.piezaId,
                      apartadas.map((p) => p.id),
                    ),
                  ),
                )
            ).map((f) => [f.piezaId, f.folio] as const),
          );
          partes.push(
            `No las tiene ${v.nombre} disponibles: ${apartadas
              .map((p) =>
                folios.has(p.id)
                  ? `${p.codigo} (apartada en ${formatoFolio(folios.get(p.id)!)})`
                  : `${p.codigo} (${p.estado})`,
              )
              .join(', ')}.`,
          );
        }
        throw new ErrorNegocio('regreso_rechazado', partes.join(' '), 'codigos');
      }
      const ids = piezas.map((p) => p.id);
      await tx
        .update(pieza)
        .set({ vendedorCustodiaId: null, version: sql`${pieza.version} + 1` })
        .where(inArray(pieza.id, ids));
      await tx.insert(movimientoPieza).values(
        ids.map((piezaId) => ({
          piezaId,
          tipo: 'regreso_vendedora' as const,
          deEstado: 'disponible' as const,
          aEstado: 'disponible' as const,
          vendedorId: d.vendedorId,
          adminId: d.adminId,
        })),
      );
      return { regresadas: ids.length };
    }),
  );
}

/** Lo que tiene la vendedora ahora (disponible o apartada), con el folio de la nota si está apartada. */
export function piezasDeVendedora(
  db: Ejecutor,
  vendedorId: string,
): Promise<
  {
    codigo: string;
    descripcion: string;
    estado: (typeof vPieza.$inferSelect)['estado'];
    folio: number | null;
  }[]
> {
  return db
    .select({
      codigo: vPieza.codigo,
      descripcion: vPieza.descripcion,
      estado: vPieza.estado,
      folio: vPedidoItem.folio,
    })
    .from(vPieza)
    .leftJoin(vPedidoItem, and(eq(vPedidoItem.piezaId, vPieza.id), eq(vPedidoItem.vigente, true)))
    .where(eq(vPieza.vendedorCustodiaId, vendedorId))
    .orderBy(asc(vPieza.codigo));
}

/**
 * Decisión P2 de la reunión: una pieza en poder de una vendedora solo se vende en una nota de esa vendedora
 * (la comisión depende del vendedor de la nota). `nombres` trae el nombre de cada vendedora con piezas.
 */
export function exigirCustodia(
  piezas: Pick<PiezaBloqueada, 'codigo' | 'vendedorCustodiaId'>[],
  vendedorId: string,
  nombres: Map<string, string>,
): void {
  const ajenas = piezas.filter((p) => p.vendedorCustodiaId && p.vendedorCustodiaId !== vendedorId);
  if (!ajenas.length) return;
  const porVendedora = new Map<string, string[]>();
  for (const p of ajenas) {
    const lista = porVendedora.get(p.vendedorCustodiaId!) ?? [];
    lista.push(p.codigo);
    porVendedora.set(p.vendedorCustodiaId!, lista);
  }
  const grupos = [...porVendedora].map(([id, codigos]) => {
    const quien = nombres.get(id) ?? 'otra vendedora';
    return `${codigos.join(', ')} ${codigos.length === 1 ? 'la tiene' : 'las tiene'} ${quien}`;
  });
  const sufijo =
    porVendedora.size === 1
      ? `la nota debe ser de ${nombres.get([...porVendedora.keys()][0]!) ?? 'esa vendedora'}, o regrésa${ajenas.length === 1 ? 'la' : 'las'} a Kazero.`
      : 'haz una nota por vendedora, o regrésalas a Kazero.';
  throw new ErrorNegocio('pieza_de_otra_vendedora', `${grupos.join('; ')}: ${sufijo}`, 'codigos');
}

/** Consulta los nombres (una sola vez, y solo si hay conflicto) y aplica `exigirCustodia`. */
export async function exigirCustodiaDe(
  tx: Ejecutor,
  piezas: Pick<PiezaBloqueada, 'codigo' | 'vendedorCustodiaId'>[],
  vendedorId: string,
): Promise<void> {
  const ajenas = piezas.flatMap((p) =>
    p.vendedorCustodiaId && p.vendedorCustodiaId !== vendedorId ? [p.vendedorCustodiaId] : [],
  );
  if (!ajenas.length) return;
  exigirCustodia(piezas, vendedorId, await nombresPor(tx, 'vendedor', ajenas));
}
