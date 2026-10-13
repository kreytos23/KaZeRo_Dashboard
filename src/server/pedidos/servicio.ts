import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import {
  aplicacionPago,
  cliente,
  pago,
  pedido,
  pedidoItem,
  pieza,
  saldoFavorMov,
  vendedor,
} from '@/db/schema';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { hoyMX, parsearFechaISO } from '@/domain/fechas';
import { descuentoLealtad, siguientePosicion, type Posicion, type SinLealtad } from '@/domain/lealtad';
import {
  MAX_PIEZAS_PEDIDO,
  calcularTotales,
  formatoFolio,
  numericAPctBps,
  pctBpsANumeric,
} from '@/domain/pedidos';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio, conflictoVersion } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import {
  apartarPiezas,
  bloquearPedido,
  bloquearPiezasDelPedido,
  bloquearPiezasParaApartar,
  exigirDisponibles,
  foliosConSaldo,
  liberarPiezas,
  liquidarSiSaldoCero,
  pagadoCentavos,
  validarCodigos,
} from './comun';

export interface DatosPedido {
  key: string;
  adminId: string;
  clienteId: string;
  vendedorId: string;
  fecha?: string;
  codigos: string[];
  cuentaTarjeta: boolean;
  descuentoManualCentavos: number;
  descuentoManualMotivo?: string | null;
  notas?: string;
}
export interface PedidoCreado {
  id: string;
  folio: number;
  estado: 'abierto' | 'liquidado';
  total: string;
  posicion: Posicion | null;
  pctBps: number;
  sinLealtad: SinLealtad | null;
  /** R-29: por qué no hubo descuento (folios de las otras notas con saldo); vacío si no aplica. */
  foliosConSaldo: number[];
}

/** Fecha de negocio: válida y no futura (D-19). */
export function validarFecha(t: string | undefined, campo = 'fecha'): string {
  if (!t?.trim()) return hoyMX();
  const f = parsearFechaISO(t);
  if (!f) throw new ErrorNegocio('fecha_invalida', 'La fecha no es válida.', campo);
  if (f > hoyMX()) throw new ErrorNegocio('fecha_invalida', 'La fecha no puede ser futura.', campo);
  return f;
}

/** Descuento manual (R-13): monto entero ≥ 0; si es > 0, motivo de 1 a 200 caracteres. */
export function validarDescuentoManual(
  centavos: number,
  motivo: string | null | undefined,
): { monto: number; motivo: string | null } {
  if (!Number.isSafeInteger(centavos) || centavos < 0)
    throw new ErrorNegocio('descuento_invalido', 'El descuento no es un monto válido.', 'descuentoManual');
  if (centavos === 0) return { monto: 0, motivo: null };
  const m = motivo?.trim() ?? '';
  if (!m) throw new ErrorNegocio('descuento_invalido', 'Escribe el motivo del descuento.', 'descuentoMotivo');
  if (m.length > 200)
    throw new ErrorNegocio('descuento_invalido', 'El motivo admite hasta 200 caracteres.', 'descuentoMotivo');
  return { monto: centavos, motivo: m };
}

export function validarNotas(notas: string | undefined): string {
  const n = (notas ?? '').trim();
  if (n.length > 500)
    throw new ErrorNegocio('notas_invalidas', 'Las notas admiten hasta 500 caracteres.', 'notas');
  return n;
}

function validarPedido(d: DatosPedido) {
  const descuento = validarDescuentoManual(d.descuentoManualCentavos, d.descuentoManualMotivo);
  // Una fecha omitida se resuelve dentro de la transacción: el payload de idempotencia guarda lo que se pidió.
  if (d.fecha?.trim()) validarFecha(d.fecha);
  return {
    clienteId: d.clienteId,
    vendedorId: d.vendedorId,
    fecha: d.fecha?.trim() || null,
    codigos: validarCodigos(d.codigos),
    cuentaTarjeta: d.cuentaTarjeta,
    descuentoManual: descuento.monto,
    descuentoMotivo: descuento.motivo,
    notas: validarNotas(d.notas),
  };
}

/** Vendedor existente y activo (D-1). Sin bloqueo: una desactivación concurrente puede pasar (aceptado, Plan 2). */
export async function exigirVendedorActivo(tx: Ejecutor, vendedorId: string): Promise<void> {
  const [v] = await tx.select({ activo: vendedor.activo }).from(vendedor).where(eq(vendedor.id, vendedorId));
  if (!v) throw new ErrorNegocio('no_encontrado', 'El vendedor no existe.', 'vendedorId');
  if (!v.activo) throw new ErrorNegocio('vendedor_inactivo', 'El vendedor está inactivo.', 'vendedorId');
}

/**
 * Una transacción, en orden de bloqueo D-10: cliente → (pedido: nuevo) → exhibidores de las piezas → piezas.
 * async a propósito: la validación síncrona también llega como promesa rechazada (minor del Plan 2).
 */
export async function crearPedido(db: Ejecutor, d: DatosPedido): Promise<PedidoCreado> {
  const v = validarPedido(d);
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key: d.key, adminId: d.adminId, operacion: 'crearPedido', payload: v },
        async (): Promise<PedidoCreado> => {
          // Contexto de auditoría (Plan 2.1) antes de cualquier escritura: si el pedido se liquida al crearse,
          // kz_auditar registra el cambio de estado.
          await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo: null });
          const fecha = validarFecha(v.fecha ?? undefined);
          // 1) Cliente: serializa la asignación de posición (R-23) y la lectura de saldos de R-29.
          const [c] = await tx
            .select({ id: cliente.id })
            .from(cliente)
            .where(eq(cliente.id, v.clienteId))
            .for('no key update');
          if (!c) throw new ErrorNegocio('no_encontrado', 'El cliente no existe.', 'clienteId');
          await exigirVendedorActivo(tx, v.vendedorId);
          // 2) Exhibidores → piezas (R-04, R-05): todo o nada.
          const { piezas, faltantes } = await bloquearPiezasParaApartar(tx, v.codigos);
          await exigirDisponibles(tx, {
            codigos: v.codigos,
            piezas,
            faltantes,
            prefijo: 'No se creó el pedido.',
          });
          // 3) Tarjeta (R-23, R-24, R-26, R-28, R-29).
          let posicion: Posicion | null = null;
          let lealtad: { pctBps: number; sinLealtad: SinLealtad | null } = { pctBps: 0, sinLealtad: null };
          let otras: number[] = [];
          if (v.cuentaTarjeta) {
            const ocupadas = await tx
              .select({ ciclo: pedido.cicloTarjeta, posicion: pedido.posicionTarjeta })
              .from(pedido)
              .where(
                and(
                  eq(pedido.clienteId, v.clienteId),
                  eq(pedido.cuentaTarjeta, true),
                  ne(pedido.estado, 'cancelado'),
                ),
              );
            posicion = siguientePosicion(ocupadas.map((o) => ({ ciclo: o.ciclo!, posicion: o.posicion! })));
            otras = await foliosConSaldo(tx, v.clienteId);
            lealtad = descuentoLealtad({
              cuentaTarjeta: true,
              posicion: posicion.posicion,
              otraNotaConSaldo: otras.length > 0,
            });
          }
          // 4) Totales (R-11, R-12, D-6, D-7).
          const t = calcularTotales(
            piezas.map((p) => numericACentavos(p.precio)),
            lealtad.pctBps,
            v.descuentoManual,
          );
          if (t.manualExcede)
            throw new ErrorNegocio(
              'descuento_excede',
              `El descuento manual supera el total después de lealtad (${formatoMXN(t.subtotal - t.descuentoLealtad)}).`,
              'descuentoManual',
            );
          const total = centavosANumeric(t.total);
          const [p] = await tx
            .insert(pedido)
            .values({
              clienteId: v.clienteId,
              vendedorId: v.vendedorId,
              fecha,
              cuentaTarjeta: v.cuentaTarjeta,
              cicloTarjeta: posicion?.ciclo ?? null,
              posicionTarjeta: posicion?.posicion ?? null,
              descuentoLealtadPct: pctBpsANumeric(lealtad.pctBps),
              sinLealtadMotivo: lealtad.sinLealtad,
              descuentoManualMonto: centavosANumeric(v.descuentoManual),
              descuentoManualMotivo: v.descuentoMotivo,
              total,
              notas: v.notas,
              adminId: d.adminId, // D-21: quién lo creó
            })
            .returning({ id: pedido.id, folio: pedido.folio });
          const pedidoId = p!.id;
          await tx.insert(pedidoItem).values(
            piezas.map((pz, i) => ({
              pedidoId,
              piezaId: pz.id,
              precioLista: pz.precio,
              precioFinal: centavosANumeric(t.preciosFinales[i]!),
            })),
          );
          await apartarPiezas(tx, { pedidoId, piezas, adminId: d.adminId });
          // D-8 / R-15: con total 0 el saldo ya es 0 y se liquida en esta misma transacción.
          const estado = (await liquidarSiSaldoCero(tx, pedidoId, d.adminId)) as 'abierto' | 'liquidado';
          return {
            id: pedidoId,
            folio: p!.folio,
            estado,
            total,
            // Objeto plano: el resultado se guarda en idempotencia.resultado (JSON) y un reintento recibe lo mismo.
            posicion: posicion ? { ciclo: posicion.ciclo, posicion: posicion.posicion } : null,
            pctBps: lealtad.pctBps,
            sinLealtad: lealtad.sinLealtad,
            foliosConSaldo: lealtad.sinLealtad ? otras : [],
          };
        },
      ),
    ),
  );
}

export interface PedidoCancelado {
  liberadas: number;
  alExhibidor: number;
  saldoFavor: string;
}

/**
 * R-17: cancela un pedido abierto. Orden de bloqueo (D-10): cliente → pedido → exhibidores → piezas (helper
 * compartido) → pagos. Las piezas vuelven al exhibidor si sigue abierto o a disponible (D-12); lo abonado pasa a
 * saldo a favor de quien pagó y las aplicaciones se anulan (no se borran). El índice parcial de la tarjeta excluye
 * cancelados: la posición queda libre (R-24).
 */
export async function cancelarPedido(
  db: Ejecutor,
  d: { key: string; adminId: string; pedidoId: string; version: number; motivo: string },
): Promise<PedidoCancelado> {
  const motivo = d.motivo.trim();
  if (!motivo || motivo.length > 200)
    throw new ErrorNegocio(
      'motivo_invalido',
      'Escribe el motivo de la cancelación (hasta 200 caracteres).',
      'motivo',
    );
  const payload = { pedidoId: d.pedidoId, version: d.version, motivo };
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key: d.key, operacion: 'cancelarPedido', adminId: d.adminId, payload },
        async (): Promise<PedidoCancelado> => {
          await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo });
          const p = await bloquearPedido(tx, d.pedidoId); // cliente → pedido
          if (p.estado === 'liquidado')
            throw new ErrorNegocio(
              'pedido_liquidado',
              'Un pedido liquidado no se cancela: primero revierte sus pagos.',
            );
          if (p.estado === 'cancelado')
            throw new ErrorNegocio('pedido_cancelado', 'El pedido ya está cancelado.');
          if (p.version !== d.version) throw conflictoVersion();
          const { piezas, abiertos, itemIds } = await bloquearPiezasDelPedido(tx, p.id);
          const r = await liberarPiezas(tx, {
            pedidoId: p.id,
            piezas,
            abiertos,
            nota: `Cancelación de ${formatoFolio(p.folio)}.`,
            adminId: d.adminId,
          });
          if (itemIds.length)
            await tx
              .update(pedidoItem)
              .set({ vigente: false, quitadoAt: sql`now()` })
              .where(inArray(pedidoItem.id, itemIds));
          // R-17 + P2: lo abonado pasa a saldo a favor de quien pagó; las aplicaciones se anulan.
          const aplicaciones = await tx
            .select({
              id: aplicacionPago.id,
              monto: aplicacionPago.monto,
              clienteId: pago.pagadorClienteId,
              vendedorId: pago.pagadorVendedorId,
            })
            .from(aplicacionPago)
            .innerJoin(pago, eq(pago.id, aplicacionPago.pagoId))
            .where(and(eq(aplicacionPago.pedidoId, p.id), isNull(aplicacionPago.anuladaAt)));
          let saldoFavor = 0;
          if (aplicaciones.length) {
            await tx
              .update(aplicacionPago)
              .set({ anuladaAt: sql`now()` })
              .where(
                inArray(
                  aplicacionPago.id,
                  aplicaciones.map((a) => a.id),
                ),
              );
            await tx.insert(saldoFavorMov).values(
              aplicaciones.map((a) => ({
                clienteId: a.clienteId,
                vendedorId: a.vendedorId,
                tipo: 'cancelacion' as const,
                monto: a.monto,
                pedidoId: p.id,
                fecha: hoyMX(),
              })),
            );
            saldoFavor = aplicaciones.reduce((s, a) => s + numericACentavos(a.monto), 0);
          }
          const filas = await tx
            .update(pedido)
            .set({
              estado: 'cancelado',
              canceladoAt: sql`now()`,
              cancelacionMotivo: motivo,
              version: sql`${pedido.version} + 1`,
            })
            .where(and(eq(pedido.id, p.id), eq(pedido.version, d.version)))
            .returning({ id: pedido.id });
          if (!filas.length) throw conflictoVersion();
          return {
            liberadas: piezas.length,
            alExhibidor: r.alExhibidor,
            saldoFavor: centavosANumeric(saldoFavor),
          };
        },
      ),
    ),
  );
}

export interface DatosEdicion {
  key: string;
  adminId: string;
  pedidoId: string;
  version: number;
  vendedorId: string;
  fecha?: string;
  descuentoManualCentavos: number;
  descuentoManualMotivo?: string | null;
  notas?: string;
  agregar: string[];
  quitar: string[];
  motivo?: string;
}

/**
 * R-27/R-22/R-11: edita un pedido abierto. La lealtad guardada (posición, %, motivo R-29) no cambia; el % guardado
 * se aplica a las piezas nuevas y las líneas que quedan conservan sus precios. Orden de bloqueo (D-10): cliente →
 * pedido → exhibidores (NO KEY UPDATE, de agregar ∪ quitar, por id) → piezas (FOR UPDATE, una consulta por id).
 * Cambiar el total o el descuento manual exige motivo (D-21); el total no puede bajar de lo ya pagado.
 */
export async function editarPedido(
  db: Ejecutor,
  d: DatosEdicion,
): Promise<{ estado: 'abierto' | 'liquidado'; total: string; cambios: true }> {
  const descuento = validarDescuentoManual(d.descuentoManualCentavos, d.descuentoManualMotivo);
  const v = {
    pedidoId: d.pedidoId,
    version: d.version,
    vendedorId: d.vendedorId,
    fecha: d.fecha?.trim() || null,
    descuentoManual: descuento.monto,
    descuentoMotivo: descuento.motivo,
    notas: validarNotas(d.notas),
    agregar: validarCodigos(d.agregar, { minimo: 0 }),
    quitar: validarCodigos(d.quitar, { minimo: 0 }),
    motivo: d.motivo?.trim() || null,
  };
  if (v.fecha) validarFecha(v.fecha);
  const ambos = v.agregar.filter((c) => v.quitar.includes(c));
  if (ambos.length)
    throw new ErrorNegocio(
      'edicion_invalida',
      `Un código no puede agregarse y quitarse a la vez: ${ambos.join(', ')}.`,
      'agregar',
    );
  if (v.motivo && v.motivo.length > 200)
    throw new ErrorNegocio('motivo_invalido', 'El motivo admite hasta 200 caracteres.', 'motivo');
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key: d.key, adminId: d.adminId, operacion: 'editarPedido', payload: v },
        async () => {
          // El motivo va al contexto: kz_auditar exige motivo si cambia `total` o el descuento manual.
          await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo: v.motivo });
          const p = await bloquearPedido(tx, v.pedidoId); // cliente → pedido
          if (p.estado !== 'abierto')
            throw new ErrorNegocio('pedido_no_abierto', 'Solo se edita un pedido abierto.');
          if (p.version !== v.version) throw conflictoVersion();
          const fecha = v.fecha ?? p.fecha;
          if (v.vendedorId !== p.vendedorId) await exigirVendedorActivo(tx, v.vendedorId);
          const items = await tx
            .select({
              piezaId: pedidoItem.piezaId,
              codigo: pieza.codigo,
              precioLista: pedidoItem.precioLista,
            })
            .from(pedidoItem)
            .innerJoin(pieza, eq(pieza.id, pedidoItem.piezaId))
            .where(and(eq(pedidoItem.pedidoId, p.id), eq(pedidoItem.vigente, true)))
            .orderBy(asc(pieza.codigo));
          const enPedido = new Set(items.map((i) => i.codigo));
          const ajenas = v.quitar.filter((c) => !enPedido.has(c));
          if (ajenas.length)
            throw new ErrorNegocio(
              'edicion_invalida',
              `No están en este pedido: ${ajenas.join(', ')}.`,
              'quitar',
            );
          const yaEstan = v.agregar.filter((c) => enPedido.has(c));
          if (yaEstan.length)
            throw new ErrorNegocio(
              'edicion_invalida',
              `Ya están en este pedido: ${yaEstan.join(', ')}.`,
              'agregar',
            );
          const quedan = items.filter((i) => !v.quitar.includes(i.codigo));
          if (quedan.length + v.agregar.length === 0)
            throw new ErrorNegocio(
              'edicion_invalida',
              'Un pedido necesita al menos una pieza. Para quitarlas todas, cancélalo.',
              'quitar',
            );
          if (quedan.length + v.agregar.length > MAX_PIEZAS_PEDIDO)
            throw new ErrorNegocio(
              'edicion_invalida',
              `Máximo ${MAX_PIEZAS_PEDIDO} piezas por pedido.`,
              'agregar',
            );
          // D-10: exhibidores de agregar ∪ quitar (por id) → piezas de agregar ∪ quitar (por id), una sola vez.
          const { piezas, faltantes, abiertos } = await bloquearPiezasParaApartar(tx, [
            ...v.agregar,
            ...v.quitar,
          ]);
          const nuevas = piezas.filter((x) => v.agregar.includes(x.codigo));
          const salen = piezas.filter((x) => v.quitar.includes(x.codigo));
          await exigirDisponibles(tx, {
            codigos: v.agregar,
            piezas: nuevas,
            faltantes: faltantes.filter((c) => v.agregar.includes(c)),
            prefijo: 'No se guardó el cambio.',
          });
          // R-27: el % guardado no cambia y se aplica a las nuevas. R-11: las que quedan conservan sus precios.
          const t = calcularTotales(
            [
              ...quedan.map((i) => numericACentavos(i.precioLista)),
              ...nuevas.map((x) => numericACentavos(x.precio)),
            ],
            numericAPctBps(p.descuentoLealtadPct),
            v.descuentoManual,
          );
          if (t.manualExcede)
            throw new ErrorNegocio(
              'descuento_excede',
              `El descuento manual supera el total después de lealtad (${formatoMXN(t.subtotal - t.descuentoLealtad)}).`,
              'descuentoManual',
            );
          const pagado = await pagadoCentavos(tx, p.id);
          if (t.total < pagado)
            throw new ErrorNegocio(
              'total_bajo_pagado',
              `El nuevo total (${formatoMXN(t.total)}) quedaría por debajo de lo ya pagado (${formatoMXN(pagado)}).`,
            );
          const total = centavosANumeric(t.total);
          const cambiaDinero =
            total !== p.total ||
            v.descuentoManual !== numericACentavos(p.descuentoManualMonto) ||
            v.descuentoMotivo !== p.descuentoManualMotivo;
          const cambia =
            cambiaDinero ||
            v.vendedorId !== p.vendedorId ||
            fecha !== p.fecha ||
            v.notas !== p.notas ||
            v.agregar.length > 0 ||
            v.quitar.length > 0;
          // Se lanza (revierte la transacción) en vez de devolver: así la llave de idempotencia queda libre para la edición real.
          if (!cambia) throw new ErrorNegocio('sin_cambios', 'No hay cambios que guardar.');
          if (cambiaDinero && !v.motivo)
            throw new ErrorNegocio('motivo_requerido', 'Escribe el motivo del cambio.', 'motivo');
          if (salen.length) {
            await liberarPiezas(tx, {
              pedidoId: p.id,
              piezas: salen,
              abiertos,
              nota: `Se quitó de ${formatoFolio(p.folio)}.`,
              adminId: d.adminId,
            });
            await tx
              .update(pedidoItem)
              .set({ vigente: false, quitadoAt: sql`now()` })
              .where(
                and(
                  eq(pedidoItem.pedidoId, p.id),
                  eq(pedidoItem.vigente, true),
                  inArray(
                    pedidoItem.piezaId,
                    salen.map((x) => x.id),
                  ),
                ),
              );
          }
          if (nuevas.length) {
            await tx.insert(pedidoItem).values(
              nuevas.map((x, i) => ({
                pedidoId: p.id,
                piezaId: x.id,
                precioLista: x.precio,
                precioFinal: centavosANumeric(t.preciosFinales[quedan.length + i]!),
              })),
            );
            await apartarPiezas(tx, { pedidoId: p.id, piezas: nuevas, adminId: d.adminId });
          }
          const filas = await tx
            .update(pedido)
            .set({
              vendedorId: v.vendedorId,
              fecha,
              descuentoManualMonto: centavosANumeric(v.descuentoManual),
              descuentoManualMotivo: v.descuentoMotivo,
              total,
              notas: v.notas,
              version: sql`${pedido.version} + 1`,
            })
            .where(and(eq(pedido.id, p.id), eq(pedido.version, v.version)))
            .returning({ id: pedido.id });
          if (!filas.length) throw conflictoVersion();
          const estado = (await liquidarSiSaldoCero(tx, p.id, d.adminId)) as 'abierto' | 'liquidado';
          return { estado, total, cambios: true as const };
        },
      ),
    ),
  );
}
