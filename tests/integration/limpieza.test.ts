import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarDatosPrueba, TABLAS_NEGOCIO } from '../../scripts/lib/limpieza';
import { conDbUrl } from '@/db/pool';
import { reiniciarConAdmin, urlOwner } from './utilidades';

const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);

describe('limpiarDatosPrueba', () => {
  let adminId: string;
  beforeEach(async () => {
    adminId = await reiniciarConAdmin();
  });

  it('borra todos los datos de negocio y conserva cuentas, sesiones y bitácora de accesos', async () => {
    await owner((db) =>
      db.execute(sql`
        WITH cat AS (INSERT INTO categoria (nombre) VALUES ('Prueba') RETURNING id),
             ven AS (INSERT INTO vendedor (nombre, tipo) VALUES ('Vendedora Prueba', 'casa') RETURNING id),
             cli AS (INSERT INTO cliente (nombre) VALUES ('Clienta Prueba') RETURNING id),
             pz AS (INSERT INTO pieza (codigo, categoria_id, descripcion, precio, fecha_alta)
                    SELECT 'ZZ01', cat.id, 'Pieza', 10, '2026-01-01' FROM cat RETURNING id),
             mv AS (INSERT INTO movimiento_pieza (pieza_id, tipo, a_estado) SELECT id, 'alta', 'disponible' FROM pz RETURNING id)
        INSERT INTO pedido (cliente_id, vendedor_id, fecha, total, admin_id, cuenta_tarjeta)
          SELECT cli.id, ven.id, '2026-01-02', 0, ${adminId}, false FROM cli, ven, mv`),
    );
    await owner((db) =>
      db.execute(sql`INSERT INTO sesion (token_hash, admin_id, nivel, expira_at, ultimo_uso_at)
        VALUES ('t', ${adminId}, 'completa', now() + interval '1 day', now())`),
    );
    await owner((db) =>
      db.execute(sql`INSERT INTO acceso_log (email, evento) VALUES ('auditor@kazero.test', 'login_ok')`),
    );

    const r = await limpiarDatosPrueba(urlOwner());
    expect(r).toMatchObject({
      pieza: 1,
      pedido: 1,
      cliente: 1,
      vendedor: 1,
      categoria: 1,
      movimiento_pieza: 1,
    });

    const n = await owner((db) =>
      db.execute(
        sql.raw(
          `SELECT ${TABLAS_NEGOCIO.map((t) => `(SELECT count(*) FROM ${t})`).join(' + ')} AS negocio,
           (SELECT count(*) FROM admin)::int AS admins, (SELECT count(*) FROM sesion)::int AS sesiones,
           (SELECT count(*) FROM acceso_log)::int AS accesos`,
        ),
      ),
    );
    expect(n.rows[0]).toMatchObject({ admins: 1, sesiones: 1, accesos: 1 });
    expect(Number(n.rows[0]!.negocio)).toBe(0);
  });

  it('toda tabla del esquema está clasificada: se limpia o se conserva (una tabla nueva obliga a decidir)', async () => {
    const conservar = ['admin', 'sesion', 'acceso_log', 'codigo_recuperacion'];
    const r = await owner((db) =>
      db.execute(sql`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`),
    );
    const tablas = (r.rows as { t: string }[]).map((x) => x.t);
    expect(tablas.filter((t) => ![...TABLAS_NEGOCIO, ...conservar].includes(t))).toEqual([]);
  });
});
