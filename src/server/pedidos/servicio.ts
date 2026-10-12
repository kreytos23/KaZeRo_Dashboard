import { and, eq, ne } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { cliente, pedido, pedidoItem, vendedor } from '@/db/schema';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { hoyMX, parsearFechaISO } from '@/domain/fechas';
import { descuentoLealtad, siguientePosicion, type Posicion, type SinLealtad } from '@/domain/lealtad';
import { calcularTotales, pctBpsANumeric } from '@/domain/pedidos';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import {
  apartarPiezas,
  bloquearPiezasParaApartar,
  exigirDisponibles,
  foliosConSaldo,
  liquidarSiSaldoCero,
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
  return {
    clienteId: d.clienteId,
    vendedorId: d.vendedorId,
    fecha: validarFecha(d.fecha),
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
              fecha: v.fecha,
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
