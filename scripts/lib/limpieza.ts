import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { conDbUrl } from '../../src/db/pool';
import { GuardaBdError } from './guarda-bd';

/**
 * Todos los datos de negocio (y su bitácora e idempotencia). NO incluye admin, sesion, acceso_log ni
 * codigo_recuperacion: las cuentas siguen entrando. El orden respeta las FK (TRUNCATE en una sola sentencia).
 */
export const TABLAS_NEGOCIO = [
  'origen_excel',
  'auditoria_campo',
  'auditoria',
  'saldo_favor_mov',
  'aplicacion_pago',
  'pago',
  'devolucion',
  'pedido_item',
  'movimiento_pieza',
  'pedido',
  'pieza',
  'exhibidor',
  'cliente',
  'vendedor',
  'categoria',
  'material',
  'proveedor',
  'idempotencia',
] as const;

export interface ArgsLimpieza {
  confirmoProduccion: boolean;
  confirmoDevelopment: boolean;
  respaldo?: string;
}

export function parsearArgsLimpieza(argv: string[]): ArgsLimpieza {
  const { values } = parseArgs({
    args: argv.filter((a, i) => !(a === '--' && i === 0)),
    options: {
      'confirmo-produccion': { type: 'boolean', default: false },
      'confirmo-development': { type: 'boolean', default: false },
      respaldo: { type: 'string' },
    },
    strict: true,
  });
  return {
    confirmoProduccion: values['confirmo-produccion']!,
    confirmoDevelopment: values['confirmo-development']!,
    respaldo: values.respaldo,
  };
}

/**
 * Llaves por destino (además de la guarda de siempre): producción exige bandera + una rama de respaldo que exista;
 * development exige su bandera; cualquier otra base exige KAZERO_OTRA_BD=confirmo explícito.
 */
export function autorizarLimpieza(
  d: { esProduccion: boolean; esDevelopment: boolean; otraBd: boolean; ramas: string[] },
  a: ArgsLimpieza,
): void {
  if (d.esProduccion) {
    if (!a.confirmoProduccion) throw new GuardaBdError('Destino = PRODUCCIÓN: falta --confirmo-produccion.');
    if (!a.respaldo || a.respaldo === 'production' || a.respaldo === 'development')
      throw new GuardaBdError(
        'Destino = PRODUCCIÓN: falta --respaldo=<rama Neon de respaldo recién creada>.',
      );
    if (!d.ramas.includes(a.respaldo))
      throw new GuardaBdError(`La rama de respaldo "${a.respaldo}" no existe en Neon.`);
    return;
  }
  if (d.esDevelopment) {
    if (!a.confirmoDevelopment)
      throw new GuardaBdError('Destino = development: falta --confirmo-development.');
    return;
  }
  if (!d.otraBd) throw new GuardaBdError('Para limpiar esta base repite con KAZERO_OTRA_BD=confirmo.');
}

/** Una transacción: bloquea, cuenta y vacía. Devuelve las filas borradas por tabla. */
export async function limpiarDatosPrueba(urlOwner: string): Promise<Record<string, number>> {
  const lista = TABLAS_NEGOCIO.join(', ');
  return conDbUrl(urlOwner, (db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
      await tx.execute(sql.raw(`LOCK TABLE ${lista} IN ACCESS EXCLUSIVE MODE`));
      const r = await tx.execute(
        sql.raw(`SELECT ${TABLAS_NEGOCIO.map((t) => `(SELECT count(*) FROM ${t})::int AS ${t}`).join(', ')}`),
      );
      await tx.execute(sql.raw(`TRUNCATE ${lista} RESTART IDENTITY`));
      return r.rows[0] as Record<string, number>;
    }),
  );
}
