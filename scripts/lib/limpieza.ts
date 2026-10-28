import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { conDbUrl } from '../../src/db/pool';
import { GuardaBdError } from './guarda-bd';

/**
 * Todos los datos de negocio (y su bitácora e idempotencia). NO incluye admin, sesion, acceso_log ni
 * codigo_recuperacion: las cuentas siguen entrando. El orden respeta las FK (TRUNCATE en una sola sentencia).
 */
export const TABLAS_NEGOCIO = [
  'pago_comision',
  'comision_linea',
  'corte_comision',
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
  'entrega_exhibidor',
  'pieza',
  'exhibidor',
  'cliente',
  'vendedor',
  'categoria',
  'material',
  'proveedor',
  'idempotencia',
] as const;

/**
 * Plan 4a: la clienta «Venta de mostrador» la crea la migración 0021; quien vacía `cliente` la vuelve a sembrar
 * con esta misma sentencia (idempotente).
 */
export const SQL_SEMBRAR_MOSTRADOR = `INSERT INTO cliente (nombre, es_mostrador, notas)
  SELECT 'Venta de mostrador', true, 'Clienta genérica para ventas de exhibidor sin clienta conocida.'
  WHERE NOT EXISTS (SELECT 1 FROM cliente WHERE es_mostrador)`;

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

export interface ResultadoLimpieza {
  borradas: Record<string, number>;
  /** Secuencias (folio KZR, orden de movimientos y bitácora…) de las tablas limpiadas que volvieron a su inicio. */
  secuencias: string[];
}

/**
 * Una transacción: bloquea, cuenta, vacía, reinicia los contadores y resiembra la clienta de mostrador. TRUNCATE ... RESTART IDENTITY solo toca las
 * secuencias de las tablas de la lista (sin CASCADE); después se reinician explícitamente las que pertenecen a esas
 * tablas, por si alguna no estuviera ligada como identidad. Las de admin/sesion/acceso_log/codigo_recuperacion no se tocan.
 */
export async function limpiarDatosPrueba(urlOwner: string): Promise<ResultadoLimpieza> {
  const lista = TABLAS_NEGOCIO.join(', ');
  const enLista = TABLAS_NEGOCIO.map((t) => `'${t}'`).join(', ');
  return conDbUrl(urlOwner, (db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
      await tx.execute(sql.raw(`LOCK TABLE ${lista} IN ACCESS EXCLUSIVE MODE`));
      const r = await tx.execute(
        sql.raw(`SELECT ${TABLAS_NEGOCIO.map((t) => `(SELECT count(*) FROM ${t})::int AS ${t}`).join(', ')}`),
      );
      await tx.execute(sql.raw(`TRUNCATE ${lista} RESTART IDENTITY`));
      const seqs = await tx.execute(
        sql.raw(`SELECT DISTINCT s.relname AS nombre FROM pg_class s
          JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
          JOIN pg_class t ON t.oid = d.refobjid AND d.refclassid = 'pg_class'::regclass
          JOIN pg_namespace n ON n.oid = s.relnamespace AND n.nspname = 'public'
          WHERE s.relkind = 'S' AND t.relname IN (${enLista}) ORDER BY 1`),
      );
      const secuencias = (seqs.rows as { nombre: string }[]).map((x) => x.nombre);
      for (const nombre of secuencias) await tx.execute(sql.raw(`ALTER SEQUENCE public."${nombre}" RESTART`));
      await tx.execute(sql.raw(SQL_SEMBRAR_MOSTRADOR));
      return { borradas: r.rows[0] as Record<string, number>, secuencias };
    }),
  );
}
