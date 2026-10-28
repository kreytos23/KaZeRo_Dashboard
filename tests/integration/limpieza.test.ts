import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarDatosPrueba, TABLAS_NEGOCIO } from '../../scripts/lib/limpieza';
import { conDbUrl } from '@/db/pool';
import { rotarAccesoLog } from '@/server/auth/rotacion';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

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

    const { borradas: r } = await limpiarDatosPrueba(urlOwner());
    expect(r).toMatchObject({
      pieza: 1,
      pedido: 1,
      cliente: 2, // + la clienta de mostrador (Plan 4a)
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
    // Solo queda la clienta de mostrador, resembrada (Plan 4a).
    expect(Number(n.rows[0]!.negocio)).toBe(1);
    const m = await owner((db) => db.execute(sql`SELECT nombre FROM cliente WHERE es_mostrador`));
    expect(m.rows).toEqual([{ nombre: 'Venta de mostrador' }]);
  });

  it('reinicia los contadores: el siguiente pedido es el primer folio y movimientos/auditoría vuelven a 1; las tablas conservadas no se tocan', async () => {
    const sembrar = (n: number) =>
      owner((db) =>
        db.execute(sql`
          WITH cat AS (INSERT INTO categoria (nombre) VALUES (${'C' + n}) RETURNING id),
               ven AS (INSERT INTO vendedor (nombre, tipo) VALUES ('V', 'casa') RETURNING id),
               cli AS (INSERT INTO cliente (nombre) VALUES ('K') RETURNING id),
               pz AS (INSERT INTO pieza (codigo, categoria_id, descripcion, precio, fecha_alta)
                      SELECT 'ZZ01', cat.id, 'Pieza', 10, '2026-01-01' FROM cat RETURNING id),
               mv AS (INSERT INTO movimiento_pieza (pieza_id, tipo, a_estado) SELECT id, 'alta', 'disponible' FROM pz RETURNING id)
          INSERT INTO pedido (cliente_id, vendedor_id, fecha, total, admin_id, cuenta_tarjeta)
            SELECT cli.id, ven.id, '2026-01-02', 0, ${adminId}, false FROM cli, ven, mv`),
      );
    await sembrar(1);
    await owner((db) =>
      db.execute(sql`SELECT nextval('pedido_folio_seq'), nextval('movimiento_pieza_orden_seq')`),
    );
    await owner((db) =>
      db.execute(sql`INSERT INTO acceso_log (email, evento) VALUES ('a@kazero.test', 'login_ok')`),
    );

    const { secuencias } = await limpiarDatosPrueba(urlOwner());
    expect(secuencias).toEqual(
      expect.arrayContaining(['pedido_folio_seq', 'movimiento_pieza_orden_seq', 'auditoria_orden_seq']),
    );
    const dueñas = await owner((db) =>
      db.execute(sql`SELECT s.relname AS n FROM pg_class s JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a','i')
        JOIN pg_class t ON t.oid = d.refobjid WHERE s.relkind = 'S'
        AND t.relname IN ('admin','sesion','acceso_log','codigo_recuperacion')`),
    );
    for (const x of dueñas.rows as { n: string }[]) expect(secuencias).not.toContain(x.n);

    await sembrar(3);
    const d = await owner((db) =>
      db.execute(sql`SELECT (SELECT min(folio) FROM pedido)::int AS folio,
        (SELECT min(orden) FROM movimiento_pieza)::int AS mov`),
    );
    expect(d.rows[0]).toMatchObject({ folio: 1, mov: 1 });
    // La bitácora solo se escribe al editar: su contador se comprueba directo (el siguiente valor es el primero).
    const a = await owner((db) => db.execute(sql`SELECT nextval('auditoria_orden_seq')::int AS n`));
    expect(a.rows[0]).toMatchObject({ n: 1 });

    const k = await owner((db) =>
      db.execute(
        sql`SELECT (SELECT count(*) FROM admin)::int AS a, (SELECT count(*) FROM acceso_log)::int AS l`,
      ),
    );
    expect(k.rows[0]).toMatchObject({ a: 1, l: 1 });
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

describe('rotarAccesoLog', () => {
  it('borra lo de más de 180 días, conserva lo de 179 y devuelve el conteo', async () => {
    await reiniciarConAdmin();
    await owner((db) =>
      db.execute(sql`INSERT INTO acceso_log (email, evento, created_at) VALUES
        ('a@x.test', 'login_ok', now() - interval '181 days'),
        ('b@x.test', 'login_ok', now() - interval '179 days')`),
    );
    const n = await conDbUrl(urlApp(), (db) => rotarAccesoLog(db));
    expect(n).toBe(1);
    const r = await owner((db) => db.execute(sql`SELECT email FROM acceso_log`));
    expect((r.rows as { email: string }[]).map((x) => x.email)).toEqual(['b@x.test']);
  });
});
