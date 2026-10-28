import { sql } from 'drizzle-orm';
import { conDbUrl } from '@/db/pool';
import { SQL_SEMBRAR_MOSTRADOR } from '../../scripts/lib/limpieza';

export const urlApp = () => process.env.DATABASE_URL!;
export const urlOwner = () => process.env.DATABASE_URL_OWNER!;
export const llaveTotp = () => process.env.KAZERO_TOTP_KEY!;

// Dos sentencias: el TRUNCATE y el resembrado de la clienta de mostrador (Plan 4a).
const TRUNCATE_TODO = `TRUNCATE pago_comision, comision_linea, corte_comision, origen_excel, auditoria_campo, auditoria, saldo_favor_mov, aplicacion_pago, pago, devolucion, pedido_item, pedido, movimiento_pieza, entrega_exhibidor, pieza, exhibidor, cliente, vendedor, categoria, material, proveedor,
      codigo_recuperacion, sesion, acceso_log, idempotencia, admin RESTART IDENTITY CASCADE; ${SQL_SEMBRAR_MOSTRADOR}`;

/** Limpia inventario, personas y auth (y resiembra la clienta de mostrador). Solo el dueño puede TRUNCATE. */
export function truncarTodo() {
  return conDbUrl(urlOwner(), (db) => db.execute(sql.raw(TRUNCATE_TODO)));
}

/**
 * Reset de cada prueba en UN solo viaje: TRUNCATE + alta de los admins mínimos (como dueño) que piden las
 * FK de la bitácora y de los movimientos. Va como consulta simple multi-sentencia (una transacción implícita);
 * devuelve los ids en el mismo orden que los correos.
 */
export async function reiniciarConAdmins(...emails: string[]): Promise<string[]> {
  const lista = emails.length ? emails : ['auditor@kazero.test'];
  const valores = lista.map((e) => `('${e.replaceAll("'", "''")}', 'h', 'c')`).join(', ');
  const r = await conDbUrl(
    urlOwner(),
    (db) =>
      db.execute(
        sql.raw(
          `${TRUNCATE_TODO}; INSERT INTO admin (email, password_hash, totp_secret_cifrado) VALUES ${valores} RETURNING id`,
        ),
      ) as unknown as Promise<{ rows: { id: string }[] }[]>,
  );
  return r[2]!.rows.map((x) => x.id);
}

/** Igual que reiniciarConAdmins con un solo admin. */
export async function reiniciarConAdmin(email = 'auditor@kazero.test'): Promise<string> {
  return (await reiniciarConAdmins(email))[0]!;
}

/** Limpia las tablas de auth. Solo el dueño puede TRUNCATE (kazero_app no). */
export function truncarAuth() {
  return conDbUrl(urlOwner(), (db) =>
    db.execute(
      sql`TRUNCATE codigo_recuperacion, sesion, acceso_log, idempotencia, admin RESTART IDENTITY CASCADE`,
    ),
  );
}

/** Admin mínimo (como dueño) para las FK de la bitácora y de los movimientos. */
export async function adminDePrueba(email = 'auditor@kazero.test'): Promise<string> {
  const r = await conDbUrl(urlOwner(), (db) =>
    db.execute<{ id: string }>(
      sql`INSERT INTO admin (email, password_hash, totp_secret_cifrado) VALUES (${email}, 'h', 'c') RETURNING id`,
    ),
  );
  return r.rows[0]!.id;
}
