import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl, type Db, type Ejecutor } from '@/db/pool';
import { pgCode, pgConstraint } from '@/db/errors';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { clavesDeImagenReferenciadas } from '@/server/piezas/imagen';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

// Plan 4b (0024/0025): referencia, comprobante y anulación de pagos; sobrante y anulación en el libro de saldo a
// favor. SQL directo (sin servicios) para probar solo la BD, como kazero_app salvo donde se indica.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const app = <T>(fn: (db: Db) => Promise<T>) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: (db: Db) => Promise<T>) => conDbUrl(urlOwner(), fn);
const enTx = <T>(fn: (tx: Tx) => Promise<T>) => app((db) => db.transaction(fn));
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

const SHA = 'a'.repeat(64);
let adminId = '';
let b: { clienteId: string; perlaId: string; exhibidorId: string };

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  b = await app(async (db) => {
    const perlaId = await idDe(
      db,
      sql`INSERT INTO vendedor (nombre, tipo) VALUES ('Perla', 'revendedora') RETURNING id`,
    );
    return {
      clienteId: await idDe(db, sql`INSERT INTO cliente (nombre) VALUES ('Gloria') RETURNING id`),
      perlaId,
      exhibidorId: await idDe(
        db,
        sql`INSERT INTO exhibidor (vendedor_id, nombre, fecha_envio) VALUES (${perlaId}, 'Estética Luz', '2026-10-01')
            RETURNING id`,
      ),
    };
  });
});

const nuevoPedido = (ej: Ejecutor, total = '300.00', vendedorId?: string) =>
  idDe(
    ej,
    sql`INSERT INTO pedido (cliente_id, vendedor_id, admin_id, fecha, total, cuenta_tarjeta)
        VALUES (${b.clienteId}, ${vendedorId ?? b.perlaId}, ${adminId}, '2026-10-10', ${total}, false) RETURNING id`,
  );
type OpPago = {
  metodo?: string;
  vendedor?: boolean;
  exhibidor?: boolean;
  referencia?: string | null;
  sha?: string | null;
};
const nuevoPago = (ej: Ejecutor, monto: string, o: OpPago = {}) =>
  idDe(
    ej,
    sql`INSERT INTO pago (idempotency_key, fecha, monto, metodo, pagador_cliente_id, pagador_vendedor_id, admin_id,
          exhibidor_id, referencia, comprobante_clave, comprobante_sha256)
        VALUES (${randomUUID()}, '2026-10-12', ${monto}, ${o.metodo ?? 'efectivo'}, ${o.vendedor ? null : b.clienteId},
                ${o.vendedor ? b.perlaId : null}, ${adminId}, ${o.exhibidor ? b.exhibidorId : null},
                ${o.referencia ?? null}, ${o.sha ? randomUUID() : null}, ${o.sha ?? null}) RETURNING id`,
  );
const aplicar = (ej: Ejecutor, pagoId: string, pedidoId: string, monto: string) =>
  idDe(
    ej,
    sql`INSERT INTO aplicacion_pago (pago_id, pedido_id, monto, fecha)
        VALUES (${pagoId}, ${pedidoId}, ${monto}, '2026-10-12') RETURNING id`,
  );
type Mov = {
  tipo: string;
  monto: string;
  vendedor?: boolean;
  pagoId?: string | null;
  pedidoId?: string | null;
  aplicacionPagoId?: string | null;
  nota?: string | null;
};
const saldoMov = (ej: Ejecutor, m: Mov) =>
  ej.execute(sql`INSERT INTO saldo_favor_mov (cliente_id, vendedor_id, tipo, monto, pago_id, pedido_id,
      aplicacion_pago_id, admin_id, nota, fecha)
    VALUES (${m.vendedor ? null : b.clienteId}, ${m.vendedor ? b.perlaId : null}, ${m.tipo}, ${m.monto},
            ${m.pagoId ?? null}, ${m.pedidoId ?? null}, ${m.aplicacionPagoId ?? null}, ${adminId}, ${m.nota ?? null},
            '2026-10-15')`);
/** Anula el pago completo como lo hará el servicio: aplicaciones, luego el pago (y el libro, si `libro`). */
const anular = (pagoId: string, libro?: (tx: Tx) => Promise<unknown>) =>
  enTx(async (tx) => {
    await tx.execute(
      sql`UPDATE aplicacion_pago SET anulada_at = now() WHERE pago_id = ${pagoId} AND anulada_at IS NULL`,
    );
    await tx.execute(sql`UPDATE pago SET anulado_at = now(), anulacion_motivo = 'Se registró dos veces',
      anulado_por = ${adminId} WHERE id = ${pagoId}`);
    if (libro) await libro(tx);
  });
/** Pago de Perla (vendedora) de 100 con 60 aplicados a su pedido y 40 de sobrante en su saldo a favor. */
const pagoConSobrante = () =>
  enTx(async (tx) => {
    const pagoId = await nuevoPago(tx, '100.00', { vendedor: true });
    await aplicar(tx, pagoId, await nuevoPedido(tx), '60.00');
    await saldoMov(tx, { tipo: 'sobrante', monto: '40.00', vendedor: true, pagoId });
    return pagoId;
  });
const saldoDe = async (vendedor = false) => {
  const r = await q(sql`SELECT coalesce(sum(monto), 0)::text AS s FROM saldo_favor_mov
    WHERE ${vendedor ? sql`vendedor_id = ${b.perlaId}` : sql`cliente_id = ${b.clienteId}`}`);
  return (r.rows[0] as { s: string }).s;
};

describe('pago: referencia y comprobante (0024)', () => {
  it('pago_referencia_largo: 1..60 sin vacíos; NULL vale', async () => {
    expect(await resultado(() => app((db) => nuevoPago(db, '10.00', { referencia: 'x'.repeat(61) })))).toBe(
      'pago_referencia_largo',
    );
    expect(await resultado(() => app((db) => nuevoPago(db, '10.00', { referencia: '  ' })))).toBe(
      'pago_referencia_largo',
    );
    expect(await resultado(() => app((db) => nuevoPago(db, '10.00', { referencia: 'SPEI 123' })))).toBe('ok');
    expect(await resultado(() => app((db) => nuevoPago(db, '10.00')))).toBe('ok');
  });

  it('pago_comprobante_coherente: clave y huella juntas; la huella es SHA-256 en hex', async () => {
    const ins = (clave: string | null, sha: string | null) =>
      q(sql`INSERT INTO pago (idempotency_key, fecha, monto, metodo, pagador_cliente_id, admin_id, comprobante_clave,
          comprobante_sha256)
        VALUES (${randomUUID()}, '2026-10-12', '10.00', 'transferencia', ${b.clienteId}, ${adminId}, ${clave}, ${sha})`);
    expect(await resultado(() => ins(randomUUID(), null))).toBe('pago_comprobante_coherente');
    expect(await resultado(() => ins(null, SHA))).toBe('pago_comprobante_coherente');
    expect(await resultado(() => ins(randomUUID(), 'A'.repeat(64)))).toBe('pago_comprobante_coherente');
    expect(await resultado(() => ins(randomUUID(), SHA))).toBe('ok');
  });

  it('la misma imagen (huella) no se registra dos veces → 23505 pago_comprobante_sha256_uq', async () => {
    await app((db) => nuevoPago(db, '10.00', { sha: SHA }));
    const r = await resultado(() => app((db) => nuevoPago(db, '10.00', { sha: SHA })));
    expect(r).toBe('pago_comprobante_sha256_uq');
    expect(await resultado(() => app((db) => nuevoPago(db, '10.00', { sha: 'b'.repeat(64) })))).toBe('ok');
  });

  it('un pago anulado suelta su huella: corregirlo es anular y registrar otro con la misma captura', async () => {
    const pagoId = await app((db) => nuevoPago(db, '10.00', { sha: SHA }));
    await anular(pagoId);
    expect(await resultado(() => app((db) => nuevoPago(db, '12.00', { sha: SHA })))).toBe('ok');
    // Entre los vigentes sigue siendo única.
    expect(await resultado(() => app((db) => nuevoPago(db, '12.00', { sha: SHA })))).toBe(
      'pago_comprobante_sha256_uq',
    );
  });

  it('el comprobante se agrega después, una vez (NULL → valor)', async () => {
    const pagoId = await app((db) => nuevoPago(db, '10.00'));
    const poner = (sha: string) =>
      q(
        sql`UPDATE pago SET comprobante_clave = ${randomUUID()}, comprobante_sha256 = ${sha} WHERE id = ${pagoId}`,
      );
    expect(await resultado(() => poner(SHA))).toBe('ok');
    expect(await resultado(() => poner('c'.repeat(64)))).toBe('pago_solo_anular_o_comprobante');
  });

  it('el barrido de imágenes huérfanas ve las claves de comprobantes', async () => {
    const pagoId = await app((db) => nuevoPago(db, '10.00', { sha: SHA }));
    const r = await q(sql`SELECT comprobante_clave AS c FROM pago WHERE id = ${pagoId}`);
    const clave = (r.rows[0] as { c: string }).c;
    expect((await app(clavesDeImagenReferenciadas)).has(clave)).toBe(true);
  });
});

describe('pago: solo se anula o recibe comprobante (0025: pago_solo_anular_o_comprobante)', () => {
  it('kazero_app no actualiza otras columnas (42501) ni borra pagos (42501)', async () => {
    const pagoId = await app((db) => nuevoPago(db, '10.00'));
    for (const s of [
      sql`UPDATE pago SET monto = 1 WHERE id = ${pagoId}`,
      sql`UPDATE pago SET referencia = 'x' WHERE id = ${pagoId}`,
      sql`UPDATE pago SET nota = 'x' WHERE id = ${pagoId}`,
      sql`DELETE FROM pago`,
    ])
      expect(await resultado(() => q(s))).toBe('42501');
  });

  it('ni el dueño cambia montos, pagador o referencia', async () => {
    const pagoId = await app((db) => nuevoPago(db, '10.00', { referencia: 'R1' }));
    for (const s of [
      sql`UPDATE pago SET monto = 11 WHERE id = ${pagoId}`,
      sql`UPDATE pago SET referencia = 'R2' WHERE id = ${pagoId}`,
      sql`UPDATE pago SET fecha = '2026-10-13' WHERE id = ${pagoId}`,
    ])
      expect(await resultado(() => owner((db) => db.execute(s)))).toBe('pago_solo_anular_o_comprobante');
  });

  it('pago_anulacion_coherente: fecha, motivo (1..200) y quién, juntos', async () => {
    const pagoId = await app((db) => nuevoPago(db, '10.00'));
    const upd = (motivo: string | null, por: string | null) =>
      q(
        sql`UPDATE pago SET anulado_at = now(), anulacion_motivo = ${motivo}, anulado_por = ${por} WHERE id = ${pagoId}`,
      );
    expect(await resultado(() => upd('Duplicado', null))).toBe('pago_anulacion_coherente');
    expect(await resultado(() => upd(null, adminId))).toBe('pago_anulacion_coherente');
    expect(await resultado(() => upd('   ', adminId))).toBe('pago_anulacion_coherente');
    expect(await resultado(() => upd('x'.repeat(201), adminId))).toBe('pago_anulacion_coherente');
    expect(await resultado(() => upd('Duplicado', adminId))).toBe('ok');
  });

  it('una anulación es definitiva: ni se deshace ni se re-fecha', async () => {
    const pagoId = await app((db) => nuevoPago(db, '10.00'));
    await anular(pagoId);
    expect(
      await resultado(() =>
        q(
          sql`UPDATE pago SET anulado_at = NULL, anulacion_motivo = NULL, anulado_por = NULL WHERE id = ${pagoId}`,
        ),
      ),
    ).toBe('pago_solo_anular_o_comprobante');
    expect(
      await resultado(() => q(sql`UPDATE pago SET anulacion_motivo = 'Otro' WHERE id = ${pagoId}`)),
    ).toBe('pago_solo_anular_o_comprobante');
  });

  it('anulado con aplicaciones vigentes → se rechaza al confirmar (pago_anulado_incompleto)', async () => {
    const pagoId = await enTx(async (tx) => {
      const id = await nuevoPago(tx, '10.00');
      await aplicar(tx, id, await nuevoPedido(tx), '10.00');
      return id;
    });
    expect(
      await resultado(() =>
        q(
          sql`UPDATE pago SET anulado_at = now(), anulacion_motivo = 'x', anulado_por = ${adminId} WHERE id = ${pagoId}`,
        ),
      ),
    ).toBe('pago_anulado_incompleto');
    expect(await resultado(() => anular(pagoId))).toBe('ok');
    const r = await q(
      sql`SELECT pago_anulado_at IS NOT NULL AS a FROM v_aplicacion_pago WHERE pago_id = ${pagoId}`,
    );
    expect(r.rows).toEqual([{ a: true }]);
  });

  it('un pago anulado no recibe aplicaciones nuevas (aplicacion_pago_pago_anulado)', async () => {
    const pagoId = await app((db) => nuevoPago(db, '10.00'));
    await anular(pagoId);
    expect(
      await resultado(() => app(async (db) => aplicar(db, pagoId, await nuevoPedido(db), '10.00'))),
    ).toBe('aplicacion_pago_pago_anulado');
  });

  it('con una aplicación anulada por cancelar su pedido no se anula (pago_anulacion_aplicacion_previa)', async () => {
    const { pagoId, pedidoId } = await enTx(async (tx) => {
      const id = await nuevoPago(tx, '10.00');
      const ped = await nuevoPedido(tx);
      await aplicar(tx, id, ped, '10.00');
      return { pagoId: id, pedidoId: ped };
    });
    // Como la cancelación (R-17): anula la aplicación, pasa lo abonado a saldo a favor y cancela el pedido.
    await enTx(async (tx) => {
      await fijarContextoAuditoria(tx, { adminId, motivo: 'Ya no lo quiere' });
      await tx.execute(sql`UPDATE aplicacion_pago SET anulada_at = now() WHERE pago_id = ${pagoId}`);
      await saldoMov(tx, { tipo: 'cancelacion', monto: '10.00', pedidoId });
      await tx.execute(sql`UPDATE pedido SET estado = 'cancelado', cancelado_at = now(),
        cancelacion_motivo = 'Ya no lo quiere' WHERE id = ${pedidoId}`);
    });
    expect(await resultado(() => anular(pagoId))).toBe('pago_anulacion_aplicacion_previa');
  });

  it('las aplicaciones que anula el propio deshacer (pedidos vivos) no cuentan como previas, sea cual sea su fecha', async () => {
    const pagoId = await enTx(async (tx) => {
      const id = await nuevoPago(tx, '10.00');
      await aplicar(tx, id, await nuevoPedido(tx), '10.00');
      return id;
    });
    expect(
      await resultado(() =>
        enTx(async (tx) => {
          await tx.execute(sql`UPDATE aplicacion_pago SET anulada_at = now() - interval '1 minute'
            WHERE pago_id = ${pagoId}`);
          await tx.execute(sql`UPDATE pago SET anulado_at = now(), anulacion_motivo = 'Duplicado',
            anulado_por = ${adminId} WHERE id = ${pagoId}`);
        }),
      ),
    ).toBe('ok');
  });
});

describe('aplicaciones: tope con sobrante y pagos de vendedora (0025: kz_validar_aplicacion_pago v2)', () => {
  it('el sobrante cuenta contra el monto: pago 100, aplicado 60, sobrante 40 → otra aplicación de 40 se rechaza', async () => {
    const pagoId = await pagoConSobrante();
    expect(
      await resultado(() => app(async (db) => aplicar(db, pagoId, await nuevoPedido(db), '40.00'))),
    ).toBe('aplicacion_pago_excede_pago');
    expect(await resultado(() => app(async (db) => aplicar(db, pagoId, await nuevoPedido(db), '0.01')))).toBe(
      'aplicacion_pago_excede_pago',
    );
  });

  it('R-32/P-1: el pago de una vendedora solo se aplica a sus pedidos (aplicacion_pago_otra_vendedora)', async () => {
    const otraId = await app((db) =>
      idDe(db, sql`INSERT INTO vendedor (nombre, tipo) VALUES ('Rosa', 'revendedora') RETURNING id`),
    );
    const pagoId = await app((db) => nuevoPago(db, '100.00', { vendedor: true }));
    expect(
      await resultado(() =>
        app(async (db) => aplicar(db, pagoId, await nuevoPedido(db, '300.00', otraId), '10.00')),
      ),
    ).toBe('aplicacion_pago_otra_vendedora');
    expect(
      await resultado(() => app(async (db) => aplicar(db, pagoId, await nuevoPedido(db), '10.00'))),
    ).toBe('ok');
    // El pago de una clienta no tiene esa restricción.
    const deClienta = await app((db) => nuevoPago(db, '10.00'));
    expect(
      await resultado(() =>
        app(async (db) => aplicar(db, deClienta, await nuevoPedido(db, '300.00', otraId), '10.00')),
      ),
    ).toBe('ok');
  });
});

describe('anulación y por entregar del exhibidor (0025: kz_validar_anulacion_pago)', () => {
  const cobrar = () =>
    enTx(async (tx) => {
      const id = await nuevoPago(tx, '300.00', { exhibidor: true });
      await aplicar(tx, id, await nuevoPedido(tx), '300.00');
      return id;
    });
  const porEntregar = async () =>
    (await q(sql`SELECT cobrado::text, por_entregar::text FROM v_exhibidor WHERE id = ${b.exhibidorId}`))
      .rows[0];

  it('sin entregas: anular baja lo cobrado y el por entregar a 0', async () => {
    const pagoId = await cobrar();
    expect(await resultado(() => anular(pagoId))).toBe('ok');
    expect(await porEntregar()).toEqual({ cobrado: '0.00', por_entregar: '0.00' });
  });

  it('ya entregado: el por entregar quedaría negativo → pago_anulacion_exhibidor_negativo', async () => {
    const pagoId = await cobrar();
    await q(sql`INSERT INTO entrega_exhibidor (exhibidor_id, tipo, monto, fecha, metodo, admin_id)
      VALUES (${b.exhibidorId}, 'entrega', '300.00', '2026-10-15', 'efectivo', ${adminId})`);
    expect(await resultado(() => anular(pagoId))).toBe('pago_anulacion_exhibidor_negativo');
    expect(await porEntregar()).toEqual({ cobrado: '300.00', por_entregar: '0.00' });
  });
});

describe('libro de saldo a favor: sobrante y anulación (0024/0025)', () => {
  it('sobrante de un pago: titular = pagador y no excede lo no aplicado', async () => {
    const pagoId = await enTx(async (tx) => {
      const id = await nuevoPago(tx, '100.00', { vendedor: true });
      await aplicar(tx, id, await nuevoPedido(tx), '60.00');
      return id;
    });
    const sobrante = (monto: string, vendedor = true) =>
      app((db) => saldoMov(db, { tipo: 'sobrante', monto, vendedor, pagoId }));
    expect(await resultado(() => sobrante('40.01'))).toBe('saldo_favor_sobrante_incoherente');
    expect(await resultado(() => sobrante('40.00', false))).toBe('saldo_favor_sobrante_incoherente');
    expect(await resultado(() => sobrante('40.00'))).toBe('ok');
    // Uno por pago (saldo_favor_mov_pago_uq).
    expect(await resultado(() => sobrante('1.00'))).toBe('saldo_favor_mov_pago_uq');
  });

  it('un sobrante sin su pago se rechaza al insertar (saldo_favor_sobrante_sin_pago)', async () => {
    for (const vendedor of [false, true])
      expect(
        await resultado(() => app((db) => saldoMov(db, { tipo: 'sobrante', monto: '5.00', vendedor }))),
      ).toBe('saldo_favor_sobrante_sin_pago');
  });

  it('saldo_favor_pago_origen: la anulación exige su pago; uso, retiro y demás no llevan pago', async () => {
    const pagoId = await app((db) => nuevoPago(db, '10.00'));
    const pedidoId = await app((db) => nuevoPedido(db));
    expect(await resultado(() => app((db) => saldoMov(db, { tipo: 'anulacion', monto: '10.00' })))).toBe(
      'saldo_favor_pago_origen',
    );
    expect(
      await resultado(() =>
        app((db) => saldoMov(db, { tipo: 'cancelacion', monto: '10.00', pedidoId, pagoId })),
      ),
    ).toBe('saldo_favor_pago_origen');
  });

  it('anular un pago con sobrante: −sobrante al mismo titular; con el pago vigente o con otro monto → error', async () => {
    const pagoId = await pagoConSobrante();
    const mov = (monto: string) => (tx: Tx) =>
      saldoMov(tx, { tipo: 'anulacion', monto, vendedor: true, pagoId });
    expect(
      await resultado(() =>
        app((db) => saldoMov(db, { tipo: 'anulacion', monto: '-40.00', vendedor: true, pagoId })),
      ),
    ).toBe('saldo_favor_anulacion_incoherente');
    expect(await resultado(() => anular(pagoId, mov('-39.00')))).toBe('saldo_favor_anulacion_incoherente');
    expect(await resultado(() => anular(pagoId, mov('40.00')))).toBe('saldo_favor_anulacion_incoherente');
    expect(await resultado(() => anular(pagoId, mov('-40.00')))).toBe('ok');
    expect(await saldoDe(true)).toBe('0.00');
    const r = await q(sql`SELECT tipo::text, pago_id FROM v_saldo_favor_mov WHERE tipo::text = 'anulacion'`);
    expect(r.rows).toEqual([{ tipo: 'anulacion', pago_id: pagoId }]);
  });

  it('anulado sin quitar el sobrante → se rechaza al confirmar (pago_anulado_incompleto)', async () => {
    const pagoId = await pagoConSobrante();
    expect(await resultado(() => anular(pagoId))).toBe('pago_anulado_incompleto');
  });

  it('sobrante ya usado: el saldo no alcanza para quitarlo → saldo_favor_insuficiente', async () => {
    const pagoId = await pagoConSobrante();
    await app((db) => saldoMov(db, { tipo: 'retiro', monto: '-30.00', vendedor: true, nota: 'Se lo llevó' }));
    expect(
      await resultado(() =>
        anular(pagoId, (tx) => saldoMov(tx, { tipo: 'anulacion', monto: '-40.00', vendedor: true, pagoId })),
      ),
    ).toBe('saldo_favor_insuficiente');
    expect(await saldoDe(true)).toBe('10.00');
  });

  it('pago con saldo a favor (clienta o vendedora): anular devuelve +monto a su titular', async () => {
    for (const vendedor of [false, true]) {
      const pedidoId = await app((db) => nuevoPedido(db));
      await app((db) => saldoMov(db, { tipo: 'cancelacion', monto: '50.00', vendedor, pedidoId }));
      // Plan 4b: la vendedora también paga con su saldo (sin pago_saldo_favor_cliente).
      const pagoId = await enTx(async (tx) => {
        const id = await nuevoPago(tx, '50.00', { metodo: 'saldo_favor', vendedor });
        const ped = await nuevoPedido(tx);
        const ap = await aplicar(tx, id, ped, '50.00');
        await saldoMov(tx, { tipo: 'uso', monto: '-50.00', vendedor, pedidoId: ped, aplicacionPagoId: ap });
        return id;
      });
      expect(await saldoDe(vendedor)).toBe('0.00');
      const mov = (monto: string) => (tx: Tx) => saldoMov(tx, { tipo: 'anulacion', monto, vendedor, pagoId });
      expect(await resultado(() => anular(pagoId, mov('49.00')))).toBe('saldo_favor_anulacion_incoherente');
      expect(await resultado(() => anular(pagoId))).toBe('pago_anulado_incompleto');
      expect(await resultado(() => anular(pagoId, mov('50.00')))).toBe('ok');
      expect(await saldoDe(vendedor)).toBe('50.00');
    }
  });
});
