import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl, type Db } from '@/db/pool';
import { pgCode } from '@/db/errors';
import {
  aplicacionPago,
  categoria,
  cliente,
  exhibidor,
  movimientoPieza,
  pago,
  pedido,
  pedidoItem,
  pieza,
  saldoFavorMov,
  vendedor,
} from '@/db/schema';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { traducirErrorPg } from '@/server/errores';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);
let adminId = '';
/** Toda actualización de pedido dispara kz_auditar: necesita el contexto de auditoría (Plan 2.1). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const conAuditoria = <T>(fn: (tx: Tx) => Promise<T>, motivo: string | null = null) =>
  app((db) =>
    db.transaction(async (tx) => {
      await fijarContextoAuditoria(tx, { adminId, motivo });
      return fn(tx);
    }),
  );
async function capturar(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
const codigoAl = async (fn: () => Promise<unknown>) => traducirErrorPg(await capturar(fn))?.codigo;

/** Filas mínimas insertadas directo (sin servicios) para probar solo la BD. */
async function base() {
  return app(async (db) => {
    const [c] = await db.insert(cliente).values({ nombre: 'Gloria' }).returning({ id: cliente.id });
    const [v] = await db
      .insert(vendedor)
      .values({ nombre: 'Kazero', tipo: 'casa' })
      .returning({ id: vendedor.id });
    const [cat] = await db.insert(categoria).values({ nombre: 'Anillos' }).returning({ id: categoria.id });
    const [pz] = await db
      .insert(pieza)
      .values({
        codigo: 'AA01',
        categoriaId: cat!.id,
        descripcion: 'Anillo',
        precio: '149.00',
        fechaAlta: '2026-10-11',
      })
      .returning({ id: pieza.id });
    // Historial coherente desde el alta (movimiento_pieza_coherente).
    await db
      .insert(movimientoPieza)
      .values({ piezaId: pz!.id, tipo: 'alta', aEstado: 'disponible', adminId });
    const [p] = await db
      .insert(pedido)
      .values({
        clienteId: c!.id,
        vendedorId: v!.id,
        adminId,
        fecha: '2026-10-11',
        total: '149.00',
        cicloTarjeta: 1,
        posicionTarjeta: 1,
      })
      .returning({ id: pedido.id, folio: pedido.folio });
    return { clienteId: c!.id, vendedorId: v!.id, piezaId: pz!.id, pedidoId: p!.id, folio: p!.folio };
  });
}
type Base = Awaited<ReturnType<typeof base>>;
const nuevoPedido = (b: Base, extra: Partial<typeof pedido.$inferInsert> = {}) =>
  app((db) =>
    db
      .insert(pedido)
      .values({
        clienteId: b.clienteId,
        vendedorId: b.vendedorId,
        adminId,
        fecha: '2026-10-11',
        total: '0',
        cicloTarjeta: 1,
        posicionTarjeta: 2,
        ...extra,
      })
      .returning({ id: pedido.id }),
  );
const nuevoPago = (b: Base, monto: string, extra: Partial<typeof pago.$inferInsert> = {}) =>
  app((db) =>
    db
      .insert(pago)
      .values({
        idempotencyKey: randomUUID(),
        fecha: '2026-10-11',
        monto,
        metodo: 'efectivo',
        pagadorClienteId: b.clienteId,
        adminId,
        ...extra,
      })
      .returning({ id: pago.id }),
  );

type EstadoPieza = typeof pieza.$inferSelect.estado;
/**
 * Como lo harán los servicios: actualiza la pieza y DESPUÉS inserta su movimiento coherente, en la misma
 * transacción (movimiento_pieza_coherente).
 */
const moverPieza = (
  piezaId: string,
  set: { estado: EstadoPieza; exhibidorId: string | null },
  mov: Omit<typeof movimientoPieza.$inferInsert, 'piezaId' | 'aEstado'>,
) =>
  app((db) =>
    db.transaction(async (tx) => {
      await tx.update(pieza).set(set).where(eq(pieza.id, piezaId));
      await tx.insert(movimientoPieza).values({ piezaId, aEstado: set.estado, adminId, ...mov });
    }),
  );

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
});

describe('reglas de pedidos en la BD', () => {
  it('el folio es consecutivo y kazero_app inserta pedidos sin privilegio extra sobre la secuencia', async () => {
    const b = await base();
    await nuevoPedido(b);
    const folios = await app((db) => db.select({ folio: pedido.folio }).from(pedido).orderBy(pedido.folio));
    expect(folios.map((f) => f.folio)).toEqual([b.folio, b.folio + 1]);
  });

  it('R-05: una pieza no puede estar en dos pedidos vigentes; sí cuando la línea anterior deja de ser vigente', async () => {
    const b = await base();
    const [p2] = await nuevoPedido(b);
    const linea = (pedidoId: string) =>
      app((db) =>
        db
          .insert(pedidoItem)
          .values({ pedidoId, piezaId: b.piezaId, precioLista: '149.00', precioFinal: '149.00' }),
      );
    await linea(b.pedidoId);
    const e = traducirErrorPg(await capturar(() => linea(p2!.id)));
    expect(e).toMatchObject({ codigo: 'pedido_item_pieza_activa_uq', campo: 'codigos' });
    await app((db) =>
      db.update(pedidoItem).set({ vigente: false }).where(eq(pedidoItem.pedidoId, b.pedidoId)),
    );
    await linea(p2!.id);
  });

  it('R-23: dos pedidos no cancelados del mismo cliente no comparten posición; cancelar la libera (R-24)', async () => {
    const b = await base();
    expect(await codigoAl(() => nuevoPedido(b, { posicionTarjeta: 1 }))).toBe('pedido_tarjeta_posicion_uq');
    // Sin tarjeta no ocupa posición.
    await nuevoPedido(b, { cuentaTarjeta: false, cicloTarjeta: null, posicionTarjeta: null });
    await conAuditoria((tx) =>
      tx
        .update(pedido)
        .set({ estado: 'cancelado', canceladoAt: new Date(), cancelacionMotivo: 'prueba' })
        .where(eq(pedido.id, b.pedidoId)),
    );
    await nuevoPedido(b, { posicionTarjeta: 1 });
  });

  it('R-18: un pedido liquidado no pasa directo a cancelado (trigger); liquidado → abierto sí', async () => {
    const b = await base();
    await conAuditoria((tx) =>
      tx
        .update(pedido)
        .set({ estado: 'liquidado', liquidadoAt: new Date() })
        .where(eq(pedido.id, b.pedidoId)),
    );
    const e = await capturar(() =>
      conAuditoria((tx) =>
        tx
          .update(pedido)
          .set({ estado: 'cancelado', liquidadoAt: null, canceladoAt: new Date(), cancelacionMotivo: 'x' })
          .where(eq(pedido.id, b.pedidoId)),
      ),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('pedido_transicion');
    await conAuditoria((tx) =>
      tx.update(pedido).set({ estado: 'abierto', liquidadoAt: null }).where(eq(pedido.id, b.pedidoId)),
    );
  });

  it('un pedido cancelado no vuelve a abrirse', async () => {
    const b = await base();
    await conAuditoria((tx) =>
      tx
        .update(pedido)
        .set({ estado: 'cancelado', canceladoAt: new Date(), cancelacionMotivo: 'x' })
        .where(eq(pedido.id, b.pedidoId)),
    );
    expect(
      await codigoAl(() =>
        conAuditoria((tx) =>
          tx
            .update(pedido)
            .set({ estado: 'abierto', canceladoAt: null, cancelacionMotivo: null })
            .where(eq(pedido.id, b.pedidoId)),
        ),
      ),
    ).toBe('pedido_transicion');
  });

  it('D-21: los cambios de pedido van a la bitácora; sin contexto se rechazan; el total exige motivo', async () => {
    const b = await base();
    const sinContexto = await capturar(() =>
      app((db) => db.update(pedido).set({ notas: 'x' }).where(eq(pedido.id, b.pedidoId))),
    );
    expect(traducirErrorPg(sinContexto)?.codigo).toBe('auditoria_sin_admin');
    const sinMotivo = await capturar(() =>
      conAuditoria((tx) => tx.update(pedido).set({ total: '100.00' }).where(eq(pedido.id, b.pedidoId))),
    );
    expect(traducirErrorPg(sinMotivo)?.codigo).toBe('auditoria_motivo_dinero');
    await conAuditoria(
      (tx) => tx.update(pedido).set({ total: '100.00' }).where(eq(pedido.id, b.pedidoId)),
      'Promoción',
    );
    const r = await app((db) =>
      db.execute(
        sql`SELECT campo, antes, despues, motivo FROM v_auditoria WHERE entidad = 'pedido' AND entidad_id = ${b.pedidoId}`,
      ),
    );
    expect(r.rows).toEqual([{ campo: 'total', antes: '149.00', despues: '100.00', motivo: 'Promoción' }]);
  });

  it('D-21: el descuento manual también exige motivo; el vendedor se audita con su nombre', async () => {
    const b = await base();
    const e = await capturar(() =>
      conAuditoria((tx) =>
        tx
          .update(pedido)
          .set({ descuentoManualMonto: '10.00', descuentoManualMotivo: 'Cliente frecuente' })
          .where(eq(pedido.id, b.pedidoId)),
      ),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('auditoria_motivo_dinero');
    const [v2] = await app((db) =>
      db.insert(vendedor).values({ nombre: 'Perla', tipo: 'revendedora' }).returning({ id: vendedor.id }),
    );
    await conAuditoria((tx) =>
      tx
        .update(pedido)
        .set({ vendedorId: v2!.id, version: sql`${pedido.version} + 1` })
        .where(eq(pedido.id, b.pedidoId)),
    );
    const r = await app((db) =>
      db.execute(
        sql`SELECT campo, antes, despues FROM v_auditoria WHERE entidad = 'pedido' AND entidad_id = ${b.pedidoId}`,
      ),
    );
    expect(r.rows).toEqual([{ campo: 'vendedor', antes: 'Kazero', despues: 'Perla' }]);
  });

  it('updated_at de pedido y de sus líneas lo mantiene un trigger', async () => {
    const b = await base();
    await app((db) =>
      db
        .insert(pedidoItem)
        .values({ pedidoId: b.pedidoId, piezaId: b.piezaId, precioLista: '149.00', precioFinal: '149.00' }),
    );
    await conAuditoria(async (tx) => {
      await tx
        .update(pedido)
        .set({ version: sql`${pedido.version} + 1` })
        .where(eq(pedido.id, b.pedidoId));
      await tx.update(pedidoItem).set({ vigente: false }).where(eq(pedidoItem.pedidoId, b.pedidoId));
    });
    // now() es la hora de inicio de la transacción: el UPDATE va en otra posterior al INSERT.
    const r = await owner((db) =>
      db.execute<{ p: boolean; i: boolean }>(sql`
        SELECT (SELECT updated_at > created_at FROM pedido WHERE id = ${b.pedidoId}) AS p,
               (SELECT updated_at > created_at FROM pedido_item WHERE pedido_id = ${b.pedidoId}) AS i`),
    );
    expect(r.rows[0]).toEqual({ p: true, i: true });
  });

  it('descuento manual > 0 exige motivo; sin tarjeta no hay posición; posición 1..10', async () => {
    const b = await base();
    const codigo = async (extra: Partial<typeof pedido.$inferInsert>) =>
      traducirErrorPg(await capturar(() => nuevoPedido(b, extra)));
    expect(await codigo({ posicionTarjeta: 3, descuentoManualMonto: '10.00' })).toMatchObject({
      codigo: 'pedido_descuento_manual',
      campo: 'descuentoMotivo',
    });
    expect((await codigo({ cuentaTarjeta: false, posicionTarjeta: 4 }))?.codigo).toBe(
      'pedido_tarjeta_coherente',
    );
    expect((await codigo({ posicionTarjeta: 11 }))?.codigo).toBe('pedido_posicion_rango');
    expect((await codigo({ posicionTarjeta: 5, total: '-1' }))?.codigo).toBe('pedido_total_no_negativo');
    expect((await codigo({ posicionTarjeta: 6, notas: 'x'.repeat(501) }))?.campo).toBe('notas');
    expect((await codigo({ posicionTarjeta: 7, estado: 'cancelado', canceladoAt: new Date() }))?.codigo).toBe(
      'pedido_cancelado_coherente',
    );
  });

  it('pagos: monto > 0 y exactamente un pagador; aplicaciones solo se anulan; nada se borra', async () => {
    const b = await base();
    expect(await codigoAl(() => nuevoPago(b, '0'))).toBe('pago_monto_positivo');
    expect(await codigoAl(() => nuevoPago(b, '10', { pagadorVendedorId: b.vendedorId }))).toBe(
      'pago_un_pagador',
    );
    const key = randomUUID();
    const [pg] = await nuevoPago(b, '10', { idempotencyKey: key });
    expect(await codigoAl(() => nuevoPago(b, '10', { idempotencyKey: key }))).toBe('pago_idempotency_key_uq');
    await app((db) =>
      db
        .insert(aplicacionPago)
        .values({ pagoId: pg!.id, pedidoId: b.pedidoId, monto: '10', fecha: '2026-10-11' }),
    );
    expect(
      pgCode(await capturar(() => app((db) => db.execute(sql`UPDATE aplicacion_pago SET monto = 1`)))),
    ).toBe('42501');
    await app((db) => db.execute(sql`UPDATE aplicacion_pago SET anulada_at = now()`));
    for (const t of ['pedido', 'pedido_item', 'pago', 'aplicacion_pago', 'saldo_favor_mov'])
      expect(pgCode(await capturar(() => app((db) => db.execute(sql.raw(`DELETE FROM ${t}`)))))).toBe(
        '42501',
      );
  });

  it('saldo a favor: exactamente un titular y signo según el tipo; v_saldo_favor suma por titular', async () => {
    const b = await base();
    const mov = (v: Partial<typeof saldoFavorMov.$inferInsert>) =>
      app((db) =>
        db.insert(saldoFavorMov).values({
          clienteId: b.clienteId,
          tipo: 'cancelacion',
          monto: '50.00',
          fecha: '2026-10-11',
          pedidoId: b.pedidoId,
          ...v,
        }),
      );
    expect(await codigoAl(() => mov({ vendedorId: b.vendedorId }))).toBe('saldo_favor_un_titular');
    expect(await codigoAl(() => mov({ monto: '-5.00' }))).toBe('saldo_favor_signo_v2');
    // cancelacion y uso nacen de un pedido; sobrante (Plan 4) no necesariamente, pero sí de su pago (Plan 4b).
    expect(await codigoAl(() => mov({ pedidoId: null }))).toBe('saldo_favor_pedido_requerido_v2');
    await mov({});
    const [pg] = await nuevoPago(b, '20.00');
    await mov({ tipo: 'sobrante', monto: '20.00', pedidoId: null, pagoId: pg!.id });
    const r = await app((db) => db.execute(sql`SELECT cliente_id, vendedor_id, saldo FROM v_saldo_favor`));
    expect(r.rows).toEqual([{ cliente_id: b.clienteId, vendedor_id: null, saldo: '70.00' }]);
  });

  it('R-14: v_pedido calcula subtotal, lealtad, pagado y saldo; v_aplicacion_pago trae el pagador', async () => {
    const b = await base();
    await app((db) =>
      db
        .insert(pedidoItem)
        .values({ pedidoId: b.pedidoId, piezaId: b.piezaId, precioLista: '149.00', precioFinal: '134.10' }),
    );
    const [pg] = await nuevoPago(b, '50');
    await app((db) =>
      db
        .insert(aplicacionPago)
        .values({ pagoId: pg!.id, pedidoId: b.pedidoId, monto: '50', fecha: '2026-10-11' }),
    );
    const r = await app((db) =>
      db.execute(
        sql`SELECT subtotal, descuento_lealtad_monto, pagado, saldo, piezas FROM v_pedido WHERE id = ${b.pedidoId}`,
      ),
    );
    expect(r.rows[0]).toEqual({
      subtotal: '149.00',
      descuento_lealtad_monto: '14.90',
      pagado: '50.00',
      saldo: '99.00',
      piezas: 1,
    });
    const a = await app((db) =>
      db.execute(
        sql`SELECT pagador_tipo, pagador_nombre, monto FROM v_aplicacion_pago WHERE pedido_id = ${b.pedidoId}`,
      ),
    );
    expect(a.rows).toEqual([{ pagador_tipo: 'cliente', pagador_nombre: 'Gloria', monto: '50.00' }]);
    const i = await app((db) =>
      db.execute(sql`SELECT folio, codigo, pieza_estado FROM v_pedido_item WHERE pedido_id = ${b.pedidoId}`),
    );
    expect(i.rows).toEqual([{ folio: b.folio, codigo: 'AA01', pieza_estado: 'disponible' }]);
  });
});

/** Barrera manual: la primera transacción escribe y espera; la segunda choca con su bloqueo. */
function barrera() {
  let soltar!: () => void;
  let listo!: () => void;
  const suelta = new Promise<void>((r) => (soltar = r));
  const escribio = new Promise<void>((r) => (listo = r));
  return { soltar, listo, suelta, escribio };
}

describe('columnas de solo avance (aplicacion_pago, pedido_item)', () => {
  async function conLinea() {
    const b = await base();
    await app((db) =>
      db
        .insert(pedidoItem)
        .values({ pedidoId: b.pedidoId, piezaId: b.piezaId, precioLista: '149.00', precioFinal: '149.00' }),
    );
    const upd = (s: ReturnType<typeof sql>) =>
      codigoAl(() =>
        app((db) => db.execute(sql`UPDATE pedido_item SET ${s} WHERE pedido_id = ${b.pedidoId}`)),
      );
    return { ...b, upd };
  }

  it('una aplicación anulada no se reactiva ni cambia de fecha de anulación', async () => {
    const b = await base();
    const [pg] = await nuevoPago(b, '10');
    await app((db) =>
      db
        .insert(aplicacionPago)
        .values({ pagoId: pg!.id, pedidoId: b.pedidoId, monto: '10', fecha: '2026-10-11' }),
    );
    await app((db) => db.execute(sql`UPDATE aplicacion_pago SET anulada_at = now()`));
    const upd = (s: ReturnType<typeof sql>) =>
      codigoAl(() => app((db) => db.execute(sql`UPDATE aplicacion_pago SET ${s}`)));
    expect(await upd(sql`anulada_at = NULL`)).toBe('aplicacion_pago_anulada_final');
    expect(await upd(sql`anulada_at = anulada_at + interval '1 day'`)).toBe('aplicacion_pago_anulada_final');
    // Reescribir el mismo valor no es un cambio.
    expect(await upd(sql`anulada_at = anulada_at`)).toBeUndefined();
  });

  it('una línea que dejó de ser vigente no vuelve; quitado_at solo se fija una vez y al salir', async () => {
    const b = await conLinea();
    await b.upd(sql`vigente = false`); // como al cancelar el pedido
    expect(await b.upd(sql`vigente = true`)).toBe('pedido_item_vigente_final');
    // Una línea ya fuera del pedido (cancelado) no se "quita" después.
    expect(await b.upd(sql`quitado_at = now()`)).toBe('pedido_item_quitado_final');
  });

  it('quitado_at no se borra ni se mueve; quitar exige dejar de ser vigente', async () => {
    const b = await conLinea();
    expect(await b.upd(sql`quitado_at = now()`)).toBe('pedido_item_quitado_coherente');
    expect(await b.upd(sql`vigente = false, quitado_at = now()`)).toBeUndefined();
    expect(await b.upd(sql`quitado_at = NULL`)).toBe('pedido_item_quitado_final');
    expect(await b.upd(sql`quitado_at = quitado_at - interval '1 day'`)).toBe('pedido_item_quitado_final');
    expect(await b.upd(sql`vigente = true, quitado_at = NULL`)).toBe('pedido_item_vigente_final');
  });

  it('cancelar (vigente = false en todas las líneas) libera las piezas: no queda ninguna línea vigente', async () => {
    const b = await conLinea();
    await b.upd(sql`vigente = false`);
    const r = await app((db) =>
      db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pedido_item WHERE vigente AND pieza_id = ${b.piezaId}`,
      ),
    );
    expect(r.rows[0]!.n).toBe(0);
    const [p2] = await nuevoPedido(b);
    await app((db) =>
      db
        .insert(pedidoItem)
        .values({ pedidoId: p2!.id, piezaId: b.piezaId, precioLista: '149.00', precioFinal: '149.00' }),
    );
  });
});

describe('libro de pagos garantizado por la BD', () => {
  const aplicar = (db: Db | Tx, pagoId: string, pedidoId: string, monto: string) =>
    db.insert(aplicacionPago).values({ pagoId, pedidoId, monto, fecha: '2026-10-11' });

  it('lo aplicado de un pago no supera su monto; lo anulado no cuenta', async () => {
    const b = await base();
    const [p2] = await nuevoPedido(b);
    const [pg] = await nuevoPago(b, '100');
    await app((db) => aplicar(db, pg!.id, b.pedidoId, '60'));
    const e = traducirErrorPg(await capturar(() => app((db) => aplicar(db, pg!.id, p2!.id, '40.01'))));
    expect(e).toMatchObject({ codigo: 'aplicacion_pago_excede_pago', campo: 'monto' });
    await app((db) => aplicar(db, pg!.id, p2!.id, '40'));
    await app((db) =>
      db.execute(sql`UPDATE aplicacion_pago SET anulada_at = now() WHERE pedido_id = ${p2!.id}`),
    );
    await app((db) => aplicar(db, pg!.id, p2!.id, '40'));
  });

  it('no se aplica un pago a un pedido cancelado', async () => {
    const b = await base();
    const [pg] = await nuevoPago(b, '10');
    await conAuditoria((tx) =>
      tx
        .update(pedido)
        .set({ estado: 'cancelado', canceladoAt: new Date(), cancelacionMotivo: 'x' })
        .where(eq(pedido.id, b.pedidoId)),
    );
    expect(await codigoAl(() => app((db) => aplicar(db, pg!.id, b.pedidoId, '10')))).toBe(
      'aplicacion_pago_pedido_cancelado',
    );
  });

  it('concurrencia: dos aplicaciones simultáneas que juntas exceden el pago → solo una entra', async () => {
    const b = await base();
    const [p2] = await nuevoPedido(b);
    const [pg] = await nuevoPago(b, '100');
    const x = barrera();
    const primera = app((db) =>
      db.transaction(async (tx) => {
        await aplicar(tx, pg!.id, b.pedidoId, '70');
        x.listo();
        await x.suelta;
      }),
    );
    await Promise.race([x.escribio, primera]); // si la primera falla, falla la prueba (no se cuelga)
    const segunda = capturar(() => app((db) => db.transaction((tx) => aplicar(tx, pg!.id, p2!.id, '70'))));
    await new Promise((r) => setTimeout(r, 1500)); // la segunda queda esperando el bloqueo del pago
    x.soltar();
    await primera;
    const e = await segunda;
    expect(traducirErrorPg(e)?.codigo).toBe('aplicacion_pago_excede_pago');
    const r = await app((db) =>
      db.execute<{ s: string }>(
        sql`SELECT sum(monto)::text AS s FROM aplicacion_pago WHERE pago_id = ${pg!.id}`,
      ),
    );
    expect(r.rows[0]!.s).toBe('70.00');
  });

  // Plan 3.1: un 'uso' ya exige su aplicación de un pago saldo_favor (ajustes-reunion-esquema.test.ts); la regla
  // "nunca negativo" (D-22) es la misma para todo lo que resta, así que aquí se prueba con un 'retiro'.
  it('el saldo a favor de un titular nunca queda negativo', async () => {
    const b = await base();
    const mov = (tipo: 'cancelacion' | 'retiro', monto: string) =>
      app((db) =>
        db.insert(saldoFavorMov).values({
          clienteId: b.clienteId,
          tipo,
          monto,
          fecha: '2026-10-11',
          ...(tipo === 'retiro' ? { adminId, nota: 'En efectivo' } : { pedidoId: b.pedidoId }),
        }),
      );
    expect(traducirErrorPg(await capturar(() => mov('retiro', '-0.01')))).toMatchObject({
      codigo: 'saldo_favor_insuficiente',
      campo: 'monto',
    });
    await mov('cancelacion', '50.00');
    await mov('retiro', '-50.00');
    expect(await codigoAl(() => mov('retiro', '-0.01'))).toBe('saldo_favor_insuficiente');
  });

  it('concurrencia: dos salidas simultáneas que juntas exceden el saldo → solo una entra', async () => {
    const b = await base();
    // Plan 3.1: 'retiro' (el 'uso' necesita su aplicación); el candado consultivo es el mismo para ambos.
    const valores = (monto: string, tipo: 'cancelacion' | 'retiro' = 'retiro') => ({
      vendedorId: b.vendedorId,
      tipo,
      monto,
      fecha: '2026-10-11',
      ...(tipo === 'retiro' ? { adminId, nota: 'En efectivo' } : { pedidoId: b.pedidoId }),
    });
    await app((db) => db.insert(saldoFavorMov).values(valores('50.00', 'cancelacion')));
    const x = barrera();
    const primera = app((db) =>
      db.transaction(async (tx) => {
        await tx.insert(saldoFavorMov).values(valores('-30.00'));
        x.listo();
        await x.suelta;
      }),
    );
    await Promise.race([x.escribio, primera]); // si la primera falla, falla la prueba (no se cuelga)
    const segunda = capturar(() =>
      app((db) => db.transaction((tx) => tx.insert(saldoFavorMov).values(valores('-30.00')))),
    );
    await new Promise((r) => setTimeout(r, 1500));
    x.soltar();
    await primera;
    expect(traducirErrorPg(await segunda)?.codigo).toBe('saldo_favor_insuficiente');
    const r = await app((db) =>
      db.execute<{ saldo: string }>(
        sql`SELECT saldo::text FROM v_saldo_favor WHERE vendedor_id = ${b.vendedorId}`,
      ),
    );
    expect(r.rows[0]!.saldo).toBe('20.00');
  });
});

describe('kz_auditar redefinida en 0013', () => {
  it('la regla anterior no se perdió: cambiar el precio de una pieza sin motivo sigue fallando', async () => {
    const b = await base();
    expect(
      await codigoAl(() =>
        conAuditoria((tx) => tx.update(pieza).set({ precio: '1.00' }).where(eq(pieza.id, b.piezaId))),
      ),
    ).toBe('auditoria_motivo_dinero');
    expect(
      await codigoAl(() =>
        app((db) => db.update(pieza).set({ descripcion: 'X' }).where(eq(pieza.id, b.piezaId))),
      ),
    ).toBe('auditoria_sin_admin');
  });
});

describe('pieza: exhibidor estable (D-11, kz_validar_transicion_pieza v4)', () => {
  async function exhibidores(vendedorId: string) {
    const [x1, x2] = await app((db) =>
      db
        .insert(exhibidor)
        .values([
          { vendedorId, nombre: 'X1', fechaEnvio: '2026-10-01' },
          { vendedorId, nombre: 'X2', fechaEnvio: '2026-10-01' },
        ])
        .returning({ id: exhibidor.id }),
    );
    return { x1: x1!.id, x2: x2!.id };
  }
  async function apartadaDeExhibidor() {
    const b = await base();
    const { x1, x2 } = await exhibidores(b.vendedorId);
    // disponible → en_exhibidor con exhibidor sigue permitido.
    await moverPieza(
      b.piezaId,
      { estado: 'en_exhibidor', exhibidorId: x1 },
      { tipo: 'envio_exhibidor', deEstado: 'disponible', exhibidorId: x1 },
    );
    await moverPieza(
      b.piezaId,
      { estado: 'apartada', exhibidorId: x1 },
      { tipo: 'apartado', deEstado: 'en_exhibidor', exhibidorId: x1, pedidoId: b.pedidoId },
    );
    return { ...b, x1, x2 };
  }

  it('una pieza apartada no puede cambiar de exhibidor', async () => {
    const b = await apartadaDeExhibidor();
    expect(
      await codigoAl(() =>
        app((db) => db.update(pieza).set({ exhibidorId: b.x2 }).where(eq(pieza.id, b.piezaId))),
      ),
    ).toBe('pieza_cambio_exhibidor');
  });

  it('apartada → en_exhibidor solo al mismo exhibidor; apartada → vendida suelta el exhibidor', async () => {
    const b = await apartadaDeExhibidor();
    expect(
      await codigoAl(() =>
        moverPieza(
          b.piezaId,
          { estado: 'en_exhibidor', exhibidorId: b.x2 },
          { tipo: 'liberacion', deEstado: 'apartada', exhibidorId: b.x2, pedidoId: b.pedidoId },
        ),
      ),
    ).toBe('pieza_cambio_exhibidor');
    await moverPieza(
      b.piezaId,
      { estado: 'vendida', exhibidorId: null },
      { tipo: 'venta', deEstado: 'apartada', exhibidorId: b.x1, pedidoId: b.pedidoId },
    );
    const r = await app((db) =>
      db.execute(
        sql`SELECT tipo, pedido_id, pedido_folio FROM v_movimiento_pieza WHERE pieza_id = ${b.piezaId} AND pedido_id IS NOT NULL ORDER BY orden`,
      ),
    );
    expect(r.rows).toEqual([
      { tipo: 'apartado', pedido_id: b.pedidoId, pedido_folio: b.folio },
      { tipo: 'venta', pedido_id: b.pedidoId, pedido_folio: b.folio },
    ]);
  });

  it('cancelar regresa la pieza a SU exhibidor (apartada → en_exhibidor, mismo exhibidor)', async () => {
    const b = await apartadaDeExhibidor();
    await moverPieza(
      b.piezaId,
      { estado: 'en_exhibidor', exhibidorId: b.x1 },
      { tipo: 'liberacion', deEstado: 'apartada', exhibidorId: b.x1, pedidoId: b.pedidoId },
    );
  });

  it('una pieza apartada sin exhibidor no gana uno', async () => {
    const b = await base();
    const { x1 } = await exhibidores(b.vendedorId);
    await moverPieza(
      b.piezaId,
      { estado: 'apartada', exhibidorId: null },
      { tipo: 'apartado', deEstado: 'disponible', pedidoId: b.pedidoId },
    );
    expect(
      await codigoAl(() =>
        app((db) => db.update(pieza).set({ exhibidorId: x1 }).where(eq(pieza.id, b.piezaId))),
      ),
    ).toBe('pieza_cambio_exhibidor');
    // Tampoco al apartarse: disponible → apartada no puede traer exhibidor.
    const otra = await app(async (db) => {
      const [pz] = await db
        .insert(pieza)
        .values({
          codigo: 'AA02',
          categoriaId: (await db.select({ id: categoria.id }).from(categoria).limit(1))[0]!.id,
          descripcion: 'Anillo',
          precio: '149.00',
          fechaAlta: '2026-10-11',
        })
        .returning({ id: pieza.id });
      return pz!.id;
    });
    expect(
      await codigoAl(() =>
        app((db) => db.update(pieza).set({ estado: 'apartada', exhibidorId: x1 }).where(eq(pieza.id, otra))),
      ),
    ).toBe('pieza_cambio_exhibidor');
  });

  it('v_exhibidor cuenta las apartadas aparte', async () => {
    const b = await apartadaDeExhibidor();
    const r = await owner((db) =>
      db.execute(sql`SELECT piezas_actuales, piezas_apartadas FROM v_exhibidor WHERE id = ${b.x1}`),
    );
    expect(r.rows[0]).toEqual({ piezas_actuales: 0, piezas_apartadas: 1 });
  });
});
