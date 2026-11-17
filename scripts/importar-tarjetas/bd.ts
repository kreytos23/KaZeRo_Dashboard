/** Lectura y escritura de la importación de tarjetas. Todo en una transacción; ensayo = ROLLBACK. */
import { sql } from 'drizzle-orm';
import { conDbUrl, type Ejecutor } from '../../src/db/pool';
import { fijarContextoAuditoria } from '../../src/server/auditoria/servicio';
import { asegurarAdminMigracion } from '../migrar-excel/aplicar';
import type { FilaTarjeta } from './leer';
import { planificarTarjetas, type ClienteBd, type PlanTarjetas, type VendedoraBd } from './planificar';

export const MOTIVO_IMPORTACION = 'Importación de tarjetas (Excel, 2026-11)';

export class ErrorPlanTarjetas extends Error {
  override name = 'ErrorPlanTarjetas';
  constructor(
    mensaje: string,
    readonly plan: PlanTarjetas,
  ) {
    super(mensaje);
  }
}
class Ensayo extends Error {
  constructor(readonly resultado: { plan: PlanTarjetas; creadas: number; actualizadas: number }) {
    super('ensayo');
  }
}

async function leerBd(tx: Ejecutor, bloquear: boolean) {
  const clientes = await tx.execute(sql`
    SELECT c.id::text AS id, c.nombre, c.compras_previas AS "comprasPrevias", c.vendedor_habitual_id::text AS "vendedorHabitualId",
           EXISTS (SELECT 1 FROM pedido p WHERE p.cliente_id = c.id AND p.cuenta_tarjeta AND p.ciclo_tarjeta = 1
                   AND p.estado::text <> 'cancelado') AS "conNotasCiclo1"
    FROM cliente c WHERE NOT c.es_mostrador ORDER BY c.id ${bloquear ? sql`FOR NO KEY UPDATE OF c` : sql``}`);
  const vendedoras = await tx.execute(sql`SELECT id::text AS id, nombre, activo FROM vendedor`);
  return {
    clientes: clientes.rows as unknown as ClienteBd[],
    vendedoras: vendedoras.rows as unknown as VendedoraBd[],
  };
}

export function simularTarjetas(url: string, filas: readonly FilaTarjeta[]): Promise<PlanTarjetas> {
  return conDbUrl(url, (db) =>
    db.transaction(async (tx) => planificarTarjetas(filas, await leerBd(tx, false))),
  );
}

export async function aplicarTarjetas(
  url: string,
  filas: readonly FilaTarjeta[],
  o: { modo: 'ensayo' | 'aplicar'; hashEsperado?: string },
): Promise<{ plan: PlanTarjetas; creadas: number; actualizadas: number }> {
  try {
    return await conDbUrl(url, (db) =>
      db.transaction(async (tx) => {
        // Bloquea todas las clientas: nadie crea notas ni las edita mientras se importa (clienta primero, D-10).
        const plan = planificarTarjetas(filas, await leerBd(tx, true));
        if (plan.errores.length)
          throw new ErrorPlanTarjetas(`El plan tiene ${plan.errores.length} errores.`, plan);
        if (o.modo === 'aplicar' && plan.hash !== o.hashEsperado)
          throw new ErrorPlanTarjetas(
            `El plan cambió (esperado ${o.hashEsperado ?? '—'}, calculado ${plan.hash}).`,
            plan,
          );
        const adminId = await asegurarAdminMigracion(tx);
        await fijarContextoAuditoria(tx, { adminId, motivo: MOTIVO_IMPORTACION });
        if (plan.crear.length)
          await tx.execute(sql`
            INSERT INTO cliente (nombre, compras_previas, vendedor_habitual_id)
            VALUES ${sql.join(
              plan.crear.map((c) => sql`(${c.nombre}, ${c.comprasPrevias}, ${c.vendedorId}::uuid)`),
              sql`, `,
            )}`);
        if (plan.actualizar.length)
          await tx.execute(sql`
            UPDATE cliente c SET compras_previas = x.previas, vendedor_habitual_id = x.vendedor, version = c.version + 1
            FROM (VALUES ${sql.join(
              plan.actualizar.map(
                (a) => sql`(${a.clienteId}::uuid, ${a.comprasPrevias}::int, ${a.vendedorId}::uuid)`,
              ),
              sql`, `,
            )})
              AS x(id, previas, vendedor)
            WHERE c.id = x.id`);
        // Verificación dentro de la transacción: tras escribir, el plan debe quedar vacío.
        const despues = planificarTarjetas(filas, await leerBd(tx, false));
        if (despues.crear.length || despues.actualizar.length || despues.errores.length)
          throw new Error('La verificación no cuadró: ROLLBACK, no quedó nada.');
        const r = { plan, creadas: plan.crear.length, actualizadas: plan.actualizar.length };
        if (o.modo === 'ensayo') throw new Ensayo(r);
        return r;
      }),
    );
  } catch (e) {
    if (e instanceof Ensayo) return e.resultado;
    throw e;
  }
}
