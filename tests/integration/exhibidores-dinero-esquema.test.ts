import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl, type Db, type Ejecutor } from '@/db/pool';
import { pgCode, pgConstraint } from '@/db/errors';
import { reiniciarConAdmin, urlApp } from './utilidades';

// Plan 4a (0020/0021): clienta de mostrador, cobro por exhibidor y entregas de dinero. SQL directo (sin
// servicios) para probar solo la BD, como kazero_app.
const app = <T>(fn: (db: Db) => Promise<T>) => conDbUrl(urlApp(), fn);
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
async function codigo(fn: () => Promise<unknown>) {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    return pgCode(e) ?? 'sin-codigo';
  }
}

let adminId = '';
let b: { clienteId: string; mostradorId: string; perlaId: string; olgaId: string; exhibidorId: string };

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  b = await app(async (db) => {
    const perlaId = await idDe(
      db,
      sql`INSERT INTO vendedor (nombre, tipo) VALUES ('Perla', 'revendedora') RETURNING id`,
    );
    return {
      clienteId: await idDe(db, sql`INSERT INTO cliente (nombre) VALUES ('Gloria') RETURNING id`),
      mostradorId: await idDe(db, sql`SELECT id FROM cliente WHERE es_mostrador`),
      perlaId,
      olgaId: await idDe(
        db,
        sql`INSERT INTO vendedor (nombre, tipo) VALUES ('Olga', 'revendedora') RETURNING id`,
      ),
      exhibidorId: await idDe(
        db,
        sql`INSERT INTO exhibidor (vendedor_id, nombre, fecha_envio) VALUES (${perlaId}, 'Estética Luz', '2026-10-01')
            RETURNING id`,
      ),
    };
  });
});

const nuevoPedido = (vendedorId = b.perlaId, clienteId = b.clienteId) =>
  app((db) =>
    idDe(
      db,
      sql`INSERT INTO pedido (cliente_id, vendedor_id, admin_id, fecha, total, cuenta_tarjeta)
          VALUES (${clienteId}, ${vendedorId}, ${adminId}, '2026-10-10', '300.00', false) RETURNING id`,
    ),
  );

/** Pago cobrado por el exhibidor y su aplicación al pedido. */
const cobrar = (pedidoId: string, monto = '300.00', exhibidorId = b.exhibidorId) =>
  app(async (db) => {
    const pagoId = await idDe(
      db,
      sql`INSERT INTO pago (idempotency_key, fecha, monto, metodo, pagador_cliente_id, admin_id, exhibidor_id)
          VALUES (${randomUUID()}, '2026-10-12', ${monto}, 'efectivo', ${b.clienteId}, ${adminId}, ${exhibidorId})
          RETURNING id`,
    );
    await db.execute(sql`INSERT INTO aplicacion_pago (pago_id, pedido_id, monto, fecha)
      VALUES (${pagoId}, ${pedidoId}, ${monto}, '2026-10-12')`);
  });

type OpEntrega = { tipo?: 'entrega' | 'ajuste'; metodo?: string | null; nota?: string | null; fecha?: SQL };
const entrega = (monto: string, o: OpEntrega = {}) => {
  const tipo = o.tipo ?? 'entrega';
  const metodo = o.metodo !== undefined ? o.metodo : tipo === 'entrega' ? 'efectivo' : null;
  return q(sql`INSERT INTO entrega_exhibidor (exhibidor_id, tipo, monto, fecha, metodo, nota, admin_id)
    VALUES (${b.exhibidorId}, ${tipo}, ${monto}, ${o.fecha ?? sql`'2026-10-15'::date`}, ${metodo}, ${o.nota ?? null},
            ${adminId})`);
};
const cerrar = (exhibidorId = b.exhibidorId) =>
  q(sql`UPDATE exhibidor SET estado = 'cerrado', cerrado_at = now() WHERE id = ${exhibidorId}`);

describe('clienta «Venta de mostrador» (0021)', () => {
  it('existe exactamente una; una segunda → 23505', async () => {
    const r = await q(sql`SELECT count(*)::int AS n, min(nombre) AS nombre FROM cliente WHERE es_mostrador`);
    expect(r.rows[0]).toEqual({ n: 1, nombre: 'Venta de mostrador' });
    expect(await codigo(() => q(sql`INSERT INTO cliente (nombre, es_mostrador) VALUES ('Otra', true)`))).toBe(
      '23505',
    );
  });

  it('sus pedidos no cuentan en tarjeta → pedido_mostrador_sin_tarjeta', async () => {
    expect(
      await resultado(() =>
        q(sql`INSERT INTO pedido (cliente_id, vendedor_id, admin_id, fecha, total, cuenta_tarjeta, ciclo_tarjeta, posicion_tarjeta)
              VALUES (${b.mostradorId}, ${b.perlaId}, ${adminId}, '2026-10-10', '300.00', true, 1, 1)`),
      ),
    ).toBe('pedido_mostrador_sin_tarjeta');
    expect(await resultado(() => nuevoPedido(b.perlaId, b.mostradorId))).toBe('ok');
  });

  it('kazero_app no cambia es_mostrador (42501) pero sí edita a la clienta', async () => {
    expect(await codigo(() => q(sql`UPDATE cliente SET es_mostrador = false`))).toBe('42501');
    expect(await codigo(() => q(sql`UPDATE cliente SET es_mostrador = true WHERE id = ${b.clienteId}`))).toBe(
      '42501',
    );
    expect(await codigo(() => q(sql`UPDATE cliente SET notas = 'x' WHERE id = ${b.clienteId}`))).toBe('ok');
  });
});

describe('cobro por el exhibidor (0021: pago_exhibidor_coherente)', () => {
  it('a un pedido de su vendedora entra; de otra vendedora → error', async () => {
    expect(await resultado(async () => cobrar(await nuevoPedido()))).toBe('ok');
    expect(await resultado(async () => cobrar(await nuevoPedido(b.olgaId)))).toBe('pago_exhibidor_coherente');
  });

  it('con el exhibidor cerrado → error', async () => {
    const p = await nuevoPedido();
    await cerrar();
    expect(await resultado(() => cobrar(p))).toBe('pago_exhibidor_coherente');
  });
});

describe('pago_exhibidor_sin_saldo (0020)', () => {
  it('un pago con saldo a favor no puede llevar exhibidor_id (23514); en efectivo sí', async () => {
    const ins = (metodo: string) =>
      q(sql`INSERT INTO pago (idempotency_key, fecha, monto, metodo, pagador_cliente_id, admin_id, exhibidor_id)
        VALUES (${randomUUID()}, '2026-10-12', '10.00', ${metodo}, ${b.clienteId}, ${adminId}, ${b.exhibidorId})`);
    expect(await resultado(() => ins('saldo_favor'))).toBe('pago_exhibidor_sin_saldo');
    expect(await resultado(() => ins('efectivo'))).toBe('ok');
  });
});

describe('entrega_exhibidor (0020/0021)', () => {
  it('por entregar = cobrado − entregas + ajustes: 300 − 100 − 20 = 180 en v_exhibidor', async () => {
    await cobrar(await nuevoPedido());
    expect(await resultado(() => entrega('301.00'))).toBe('entrega_exhibidor_excede');
    expect(await resultado(() => entrega('100.00'))).toBe('ok');
    expect(await resultado(() => entrega('-20.00', { tipo: 'ajuste', nota: 'Faltante en el conteo' }))).toBe(
      'ok',
    );
    const r = await q(sql`SELECT cobrado::text, entregado::text, ajustes::text, por_entregar::text
      FROM v_exhibidor WHERE id = ${b.exhibidorId}`);
    expect(r.rows[0]).toEqual({
      cobrado: '300.00',
      entregado: '100.00',
      ajustes: '-20.00',
      por_entregar: '180.00',
    });
    expect((await q(sql`SELECT kz_por_entregar(${b.exhibidorId})::text AS n`)).rows[0]).toEqual({
      n: '180.00',
    });
    // Un ajuste negativo tampoco deja el por entregar bajo cero.
    expect(await resultado(() => entrega('-180.01', { tipo: 'ajuste', nota: 'x' }))).toBe(
      'entrega_exhibidor_excede',
    );
  });

  it('sin cobros, v_exhibidor da ceros', async () => {
    const r = await q(sql`SELECT cobrado::text, entregado::text, ajustes::text, por_entregar::text
      FROM v_exhibidor WHERE id = ${b.exhibidorId}`);
    expect(r.rows[0]).toEqual({ cobrado: '0', entregado: '0', ajustes: '0', por_entregar: '0' });
  });

  it('CHECK: ajuste con motivo; entrega > 0 con método; ajuste ≠ 0 sin método; fecha no futura', async () => {
    await cobrar(await nuevoPedido());
    expect(await resultado(() => entrega('10.00', { tipo: 'ajuste', nota: null }))).toBe(
      'entrega_exhibidor_ajuste_motivo',
    );
    expect(await resultado(() => entrega('10.00', { tipo: 'ajuste', nota: '   ' }))).toBe(
      'entrega_exhibidor_ajuste_motivo',
    );
    expect(await resultado(() => entrega('0', { tipo: 'ajuste', nota: 'x' }))).toBe(
      'entrega_exhibidor_monto',
    );
    expect(await resultado(() => entrega('-5.00'))).toBe('entrega_exhibidor_monto');
    expect(await resultado(() => entrega('5.00', { metodo: null }))).toBe('entrega_exhibidor_metodo');
    expect(await resultado(() => entrega('5.00', { tipo: 'ajuste', nota: 'x', metodo: 'efectivo' }))).toBe(
      'entrega_exhibidor_metodo',
    );
    expect(await resultado(() => entrega('5.00', { nota: 'x'.repeat(201) }))).toBe('entrega_exhibidor_nota');
    expect(
      await resultado(() =>
        entrega('5.00', { fecha: sql`((now() AT TIME ZONE 'America/Mexico_City')::date + 1)` }),
      ),
    ).toBe('entrega_exhibidor_fecha');
    expect(
      await resultado(() =>
        entrega('5.00', { fecha: sql`(now() AT TIME ZONE 'America/Mexico_City')::date` }),
      ),
    ).toBe('ok');
  });

  it('solo inserción: UPDATE y DELETE como kazero_app → 42501', async () => {
    await cobrar(await nuevoPedido());
    await entrega('100.00');
    for (const s of [sql`UPDATE entrega_exhibidor SET monto = 1`, sql`DELETE FROM entrega_exhibidor`]) {
      expect(await codigo(() => q(s))).toBe('42501');
    }
  });
});

describe('exhibidor cerrado (0021: entrega_exhibidor_cerrado)', () => {
  it('no admite entregas ni ajustes positivos', async () => {
    expect(await resultado(() => cerrar())).toBe('ok');
    expect(await resultado(() => entrega('10.00'))).toBe('entrega_exhibidor_cerrado');
    expect(await resultado(() => entrega('10.00', { tipo: 'ajuste', nota: 'Sobrante' }))).toBe(
      'entrega_exhibidor_cerrado',
    );
  });
});

describe('cierre del exhibidor (0021: exhibidor_cierre_con_dinero)', () => {
  it('con dinero por entregar no se cierra; al entregarlo todo, sí', async () => {
    await cobrar(await nuevoPedido());
    await entrega('100.00');
    expect(await resultado(() => cerrar())).toBe('exhibidor_cierre_con_dinero');
    await entrega('200.00');
    expect(await resultado(() => cerrar())).toBe('ok');
  });
});
