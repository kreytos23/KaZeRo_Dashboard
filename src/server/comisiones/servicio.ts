import { and, eq, isNull, sql } from 'drizzle-orm';
import { pgConstraint } from '@/db/errors';
import type { Ejecutor } from '@/db/pool';
import { comisionLinea, corteComision, metodoPagoComision, pagoComision, vendedor } from '@/db/schema';
import { comisionCentavos, finDeMes, mesCerrable, nombreMes } from '@/domain/comisiones';
import { centavosANumeric, numericACentavos } from '@/domain/dinero';
import { hoyMX, parsearFechaISO } from '@/domain/fechas';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import { validarFecha } from '@/server/pedidos/servicio';
import { calcularMesAbierto, consultaElegibles, mensajeNoTerminado } from './lecturas';


/** Mes del corte y nombre de la vendedora en una sola lectura (`nombre` nulo si la vendedora no existe). */
async function corteYVendedora(db: Ejecutor, corteId: string, vendedorId: string) {
  const [r] = await db
    .select({ mes: corteComision.mes, nombre: vendedor.nombre })
    .from(corteComision)
    .leftJoin(vendedor, eq(vendedor.id, vendedorId))
    .where(eq(corteComision.id, corteId));
  return r;
}

const yaPagado = (nombre: string, mes: string) =>
  new ErrorNegocio('ya_pagado', `La comisión de ${nombre} de ${nombreMes(mes)} ya está pagada.`);

/**
 * Cierra el mes `mes`: congela en `comision_linea` los pedidos liquidados hasta su último día (D-2, D-3). Un
 * candado consultivo serializa los cierres; los pedidos van FOR UPDATE y `comision_linea_pedido_uq` impide
 * comisionar dos veces. `hoy` solo se pasa en pruebas.
 */
export async function cerrarMesComisiones(
  db: Ejecutor,
  d: { key: string; adminId: string; mes: string; hoy?: string },
): Promise<{ mes: string; corteId: string; numPedidos: number; totalCentavos: number }> {
  if (!/^\d{4}-\d{2}-01$/.test(d.mes) || !parsearFechaISO(d.mes))
    throw new ErrorNegocio('dato_invalido', 'El mes no es válido.', 'mes');
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key: d.key, adminId: d.adminId, operacion: 'cerrarMesComisiones', payload: { mes: d.mes } },
        async () => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('kz_cierre_comisiones'))`);
          const hoy = d.hoy ?? hoyMX();
          const yaCerrado = await tx
            .select({ id: corteComision.id })
            .from(corteComision)
            .where(eq(corteComision.mes, d.mes));
          if (yaCerrado.length) throw new ErrorNegocio('ya_cerrado', `${nombreMes(d.mes)} ya se cerró.`);
          const abierto = await calcularMesAbierto(tx, hoy);
          if (d.mes !== abierto)
            throw new ErrorNegocio('mes_fuera_de_orden', `Primero cierra ${nombreMes(abierto)}.`);
          if (!mesCerrable(d.mes, hoy)) throw new ErrorNegocio('mes_no_terminado', mensajeNoTerminado(d.mes));
          const filas = await consultaElegibles(tx, finDeMes(d.mes), { bloquear: true });
          const [corte] = await tx
            .insert(corteComision)
            .values({ mes: d.mes, adminId: d.adminId })
            .returning({ id: corteComision.id });
          const lineas = filas.map((f) => ({
            corteId: corte!.id,
            vendedorId: f.vendedorId,
            pedidoId: f.pedidoId,
            fechaLiquidacion: f.fechaLiquidacion,
            base: f.total,
            pct: f.comisionPct,
            monto: centavosANumeric(comisionCentavos(numericACentavos(f.total), f.comisionPct)),
          }));
          if (lineas.length) await tx.insert(comisionLinea).values(lineas);
          return {
            mes: d.mes,
            corteId: corte!.id,
            numPedidos: lineas.length,
            totalCentavos: lineas.reduce((s, l) => s + numericACentavos(l.monto), 0),
          };
        },
      ),
    ),
  );
}

/** Paga a la vendedora lo comisionado en el corte (monto calculado, no tecleado). Un pago vigente por vendedora y corte. */
export async function registrarPagoComision(
  db: Ejecutor,
  d: {
    key: string;
    adminId: string;
    corteId: string;
    vendedorId: string;
    fecha?: string;
    metodo: string;
    nota?: string;
  },
): Promise<{ pagoId: string; montoCentavos: number }> {
  const metodo = metodoPagoComision.enumValues.find((m) => m === d.metodo);
  if (!metodo)
    throw new ErrorNegocio('metodo_invalido', 'Elige un método de pago válido.', 'metodo');
  const nota = d.nota?.trim() || null;
  if (nota && nota.length > 200)
    throw new ErrorNegocio('nota_invalida', 'La nota admite hasta 200 caracteres.', 'nota');
  // Una fecha omitida se resuelve dentro de la transacción (hoy de esa llamada).
  const fechaPago = d.fecha?.trim() ? validarFecha(d.fecha) : null;
  const payload = { corteId: d.corteId, vendedorId: d.vendedorId, fecha: fechaPago, metodo, nota };
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key: d.key, adminId: d.adminId, operacion: 'registrarPagoComision', payload },
        async () => {
          const fecha = fechaPago ?? hoyMX();
          const corte = await corteYVendedora(tx, d.corteId, d.vendedorId);
          if (!corte) throw new ErrorNegocio('no_encontrado', 'Ese mes no tiene cierre.');
          if (!corte.nombre) throw new ErrorNegocio('no_encontrado', 'La vendedora no existe.');
          const [suma] = await tx
            .select({ total: sql<string>`coalesce(sum(${comisionLinea.monto}), 0)::text` })
            .from(comisionLinea)
            .where(and(eq(comisionLinea.corteId, d.corteId), eq(comisionLinea.vendedorId, d.vendedorId)));
          const monto = numericACentavos(suma!.total);
          if (monto === 0)
            throw new ErrorNegocio(
              'sin_comision',
              `${corte.nombre} no tiene comisión en ${nombreMes(corte.mes)}.`,
            );
          const [vigente] = await tx
            .select({ id: pagoComision.id })
            .from(pagoComision)
            .where(
              and(
                eq(pagoComision.corteId, d.corteId),
                eq(pagoComision.vendedorId, d.vendedorId),
                isNull(pagoComision.anuladoAt),
              ),
            );
          if (vigente) throw yaPagado(corte.nombre, corte.mes);
          const [pago] = await tx
            .insert(pagoComision)
            .values({
              corteId: d.corteId,
              vendedorId: d.vendedorId,
              fecha,
              monto: centavosANumeric(monto),
              metodo,
              nota,
              adminId: d.adminId,
            })
            .returning({ id: pagoComision.id });
          return { pagoId: pago!.id, montoCentavos: monto };
        },
      ),
    ),
  ).catch(async (e: unknown) => {
    // Carrera de dos pagos simultáneos: el índice único vigente rechaza al segundo.
    if (pgConstraint(e) !== 'pago_comision_vigente_uq') throw e;
    const r = await corteYVendedora(db, d.corteId, d.vendedorId);
    if (!r?.nombre) throw e;
    throw yaPagado(r.nombre, r.mes);
  });
}

/** Deshace un pago (solo cambia las columnas de anulación). Después se puede registrar otro. */
export async function anularPagoComision(
  db: Ejecutor,
  d: { key: string; adminId: string; pagoId: string; motivo: string },
): Promise<{ ok: true }> {
  const motivo = d.motivo?.trim() ?? '';
  if (!motivo || motivo.length > 200)
    throw new ErrorNegocio(
      'motivo_invalido',
      'Escribe por qué se deshace el pago (hasta 200 caracteres).',
      'motivo',
    );
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        {
          key: d.key,
          adminId: d.adminId,
          operacion: 'anularPagoComision',
          payload: { pagoId: d.pagoId, motivo },
        },
        async (): Promise<{ ok: true }> => {
          const [p] = await tx
            .select({ anuladoAt: pagoComision.anuladoAt })
            .from(pagoComision)
            .where(eq(pagoComision.id, d.pagoId))
            .for('update');
          if (!p) throw new ErrorNegocio('no_encontrado', 'El pago no existe.');
          if (p.anuladoAt) throw new ErrorNegocio('pago_anulado', 'Ese pago ya estaba deshecho.');
          await tx
            .update(pagoComision)
            .set({ anuladoAt: sql`now()`, anulacionMotivo: motivo, anuladoPor: d.adminId })
            .where(eq(pagoComision.id, d.pagoId));
          return { ok: true };
        },
      ),
    ),
  );
}
