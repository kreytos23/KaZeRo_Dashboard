import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl, type Db, type Ejecutor } from '@/db/pool';
import { pgCode, pgConstraint } from '@/db/errors';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

// Plan 5a (0018/0019): cortes, líneas y pagos de comisión; kz_fecha_liquidacion y kz_rotar_acceso_log.
// SQL directo (sin servicios) para probar solo la BD. Como kazero_app salvo donde se indica.
const app = <T>(fn: (db: Db) => Promise<T>) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: (db: Db) => Promise<T>) => conDbUrl(urlOwner(), fn);
const q = (s: SQL) => app((db) => db.execute(s));
async function idDe(ej: Ejecutor, s: SQL) {
  const r = await ej.execute<{ id: string }>(s);
  return r.rows[0]!.id;
}
/** 'ok', o el nombre de la constraint violada (o el SQLSTATE si no trae nombre). */
async function resultado(fn: () => Promise<unknown>) {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    return pgConstraint(e) ?? pgCode(e) ?? 'sin-codigo';
  }
}

let adminId = '';
let b: { clienteId: string; nellyId: string; olgaId: string };

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  b = await app(async (db) => ({
    clienteId: await idDe(db, sql`INSERT INTO cliente (nombre) VALUES ('Gloria') RETURNING id`),
    nellyId: await idDe(
      db,
      sql`INSERT INTO vendedor (nombre, tipo) VALUES ('Nelly', 'revendedora') RETURNING id`,
    ),
    olgaId: await idDe(
      db,
      sql`INSERT INTO vendedor (nombre, tipo) VALUES ('Olga', 'revendedora') RETURNING id`,
    ),
  }));
});

type OpPedido = { estado?: 'abierto' | 'liquidado'; total?: string; liquidadoAt?: string };
const nuevoPedido = (o: OpPedido = {}) => {
  const estado = o.estado ?? 'liquidado';
  const liq =
    estado === 'liquidado' ? (o.liquidadoAt ? sql`${o.liquidadoAt}::timestamptz` : sql`now()`) : null;
  return app((db) =>
    idDe(
      db,
      sql`INSERT INTO pedido (cliente_id, vendedor_id, admin_id, fecha, total, estado, liquidado_at, cuenta_tarjeta)
          VALUES (${b.clienteId}, ${b.nellyId}, ${adminId}, '2026-10-10', ${o.total ?? '149.00'}, ${estado}, ${liq}, false)
          RETURNING id`,
    ),
  );
};

const nuevoCorte = (mes = '2026-10-01') =>
  app((db) =>
    idDe(db, sql`INSERT INTO corte_comision (mes, admin_id) VALUES (${mes}, ${adminId}) RETURNING id`),
  );

type OpLinea = { vendedorId?: string; base?: string; monto?: string };
const linea = (corteId: string, pedidoId: string, o: OpLinea = {}) =>
  q(sql`INSERT INTO comision_linea (corte_id, vendedor_id, pedido_id, fecha_liquidacion, base, pct, monto)
        VALUES (${corteId}, ${o.vendedorId ?? b.nellyId}, ${pedidoId}, '2026-10-10', ${o.base ?? '149.00'}, '20.00',
                ${o.monto ?? '29.80'})`);

const pagoCom = (corteId: string, monto: string, vendedorId = b.nellyId) =>
  app((db) =>
    idDe(
      db,
      sql`INSERT INTO pago_comision (corte_id, vendedor_id, fecha, monto, metodo, admin_id)
          VALUES (${corteId}, ${vendedorId}, '2026-11-05', ${monto}, 'efectivo', ${adminId}) RETURNING id`,
    ),
  );
const anular = (pagoId: string) =>
  q(sql`UPDATE pago_comision SET anulado_at = now(), anulacion_motivo = 'Se registró dos veces', anulado_por = ${adminId}
        WHERE id = ${pagoId}`);

describe('comision_linea (0019: comision_linea_validar)', () => {
  it('línea coherente entra; base ≠ total, otra vendedora o pedido abierto → comision_linea_coherente', async () => {
    const corte = await nuevoCorte();
    const p = await nuevoPedido();
    expect(await resultado(() => linea(corte, p, { base: '150.00' }))).toBe('comision_linea_coherente');
    expect(await resultado(() => linea(corte, p, { vendedorId: b.olgaId }))).toBe('comision_linea_coherente');
    const abierto = await nuevoPedido({ estado: 'abierto' });
    expect(await resultado(() => linea(corte, abierto))).toBe('comision_linea_coherente');
    expect(await resultado(() => linea(corte, p))).toBe('ok');
    // Un pedido se comisiona una sola vez, aunque sea en otro corte.
    expect(await resultado(() => linea(corte, p))).toBe('comision_linea_pedido_uq');
    const otro = await nuevoCorte('2026-11-01');
    expect(await resultado(() => linea(otro, p))).toBe('comision_linea_pedido_uq');
  });

  it('CHECK: el corte es del día 1 y el monto no supera la base', async () => {
    expect(await resultado(() => nuevoCorte('2026-10-02'))).toBe('corte_comision_mes_inicio');
    await nuevoCorte();
    expect(await resultado(() => nuevoCorte())).toBe('corte_comision_mes_uq');
    const corte = await nuevoCorte('2026-11-01');
    const p = await nuevoPedido();
    expect(await resultado(() => linea(corte, p, { monto: '149.01' }))).toBe('comision_linea_monto');
  });
});

describe('pago_comision (0019: pago_comision_validar y pago_comision_solo_anular)', () => {
  it('el monto es la suma de las líneas de la vendedora en el corte; una sola vigente; anular y volver a pagar', async () => {
    const corte = await nuevoCorte();
    await linea(corte, await nuevoPedido());
    await linea(corte, await nuevoPedido({ total: '100.00' }), { base: '100.00', monto: '20.00' });
    expect(await resultado(() => pagoCom(corte, '49.79'))).toBe('pago_comision_monto_coherente');
    // Olga no tiene líneas en el corte: no hay nada que pagarle.
    expect(await resultado(() => pagoCom(corte, '49.80', b.olgaId))).toBe('pago_comision_monto_coherente');
    const pagoId = await pagoCom(corte, '49.80');
    expect(await resultado(() => pagoCom(corte, '49.80'))).toBe('pago_comision_vigente_uq');

    expect(await resultado(() => anular(pagoId))).toBe('ok');
    expect(await resultado(() => anular(pagoId))).toBe('pago_comision_inmutable');
    // Tras anular, se registra el pago correcto.
    expect(await resultado(() => pagoCom(corte, '49.80'))).toBe('ok');
  });

  it('no nace anulado; kazero_app no cambia el monto (grant) y ni el dueño lo cambia (trigger)', async () => {
    const corte = await nuevoCorte();
    await linea(corte, await nuevoPedido());
    expect(
      await resultado(() =>
        q(sql`INSERT INTO pago_comision (corte_id, vendedor_id, fecha, monto, metodo, admin_id, anulado_at,
                anulacion_motivo, anulado_por)
              VALUES (${corte}, ${b.nellyId}, '2026-11-05', '29.80', 'efectivo', ${adminId}, now(), 'x', ${adminId})`),
      ),
    ).toBe('pago_comision_nace_vigente');
    const pagoId = await pagoCom(corte, '29.80');
    expect(await resultado(() => q(sql`UPDATE pago_comision SET monto = 1 WHERE id = ${pagoId}`))).toBe(
      '42501',
    );
    expect(
      await resultado(() =>
        owner((db) => db.execute(sql`UPDATE pago_comision SET monto = 1 WHERE id = ${pagoId}`)),
      ),
    ).toBe('pago_comision_inmutable');
    // Anular a medias lo rechaza el CHECK.
    expect(
      await resultado(() => q(sql`UPDATE pago_comision SET anulado_at = now() WHERE id = ${pagoId}`)),
    ).toBe('pago_comision_anulacion');
  });
});

describe('cortes y líneas son de solo inserción', () => {
  it('UPDATE y DELETE en corte_comision y comision_linea → permission denied', async () => {
    const corte = await nuevoCorte();
    await linea(corte, await nuevoPedido());
    for (const s of [
      sql`UPDATE corte_comision SET mes = mes`,
      sql`DELETE FROM corte_comision`,
      sql`UPDATE comision_linea SET monto = monto`,
      sql`DELETE FROM comision_linea`,
      sql`DELETE FROM pago_comision`,
    ]) {
      expect(await resultado(() => q(s))).toBe('42501');
    }
  });
});

describe('kz_fecha_liquidacion (D-3)', () => {
  const fl = async (pedidoId: string) =>
    (await q(sql`SELECT kz_fecha_liquidacion(${pedidoId})::text AS f`)).rows[0]!.f;

  it('la mayor fecha de las aplicaciones vigentes; sin aplicaciones, la fecha MX de liquidado_at', async () => {
    const p = await nuevoPedido();
    await app(async (db) => {
      const pagoId = await idDe(
        db,
        sql`INSERT INTO pago (idempotency_key, fecha, monto, metodo, pagador_cliente_id, admin_id)
            VALUES (${randomUUID()}, '2026-10-12', '149.00', 'efectivo', ${b.clienteId}, ${adminId}) RETURNING id`,
      );
      await db.execute(sql`INSERT INTO aplicacion_pago (pago_id, pedido_id, monto, fecha)
        VALUES (${pagoId}, ${p}, '49.00', '2026-10-12'), (${pagoId}, ${p}, '100.00', '2026-10-20')`);
      await db.execute(
        sql`UPDATE aplicacion_pago SET anulada_at = now() WHERE pedido_id = ${p} AND fecha = '2026-10-20'`,
      );
    });
    expect(await fl(p)).toBe('2026-10-12');

    const cero = await nuevoPedido({ total: '0.00', liquidadoAt: '2026-12-01T05:30:00Z' });
    expect(await fl(cero)).toBe('2026-11-30');
  });
});

describe('kz_rotar_acceso_log (D-8)', () => {
  it('borra lo de más de 180 días y conserva lo demás; kazero_app no borra directo', async () => {
    await owner((db) =>
      db.execute(sql`INSERT INTO acceso_log (email, evento, created_at) VALUES
        ('viejo@kazero.test', 'login_ok', now() - interval '181 days'),
        ('reciente@kazero.test', 'login_ok', now() - interval '179 days')`),
    );
    expect(await resultado(() => q(sql`DELETE FROM acceso_log`))).toBe('42501');
    const r = await q(sql`SELECT kz_rotar_acceso_log() AS n`);
    expect(r.rows[0]!.n).toBe(1);
    const quedan = await q(sql`SELECT email FROM acceso_log`);
    expect(quedan.rows.map((x) => x.email)).toEqual(['reciente@kazero.test']);
  });
});
