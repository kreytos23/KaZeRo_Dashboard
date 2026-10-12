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
import { adminDePrueba, truncarTodo, urlApp, urlOwner } from './utilidades';

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
  await truncarTodo();
  adminId = await adminDePrueba();
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

  it('R-27: kazero_app no puede cambiar folio, cliente ni lealtad de un pedido', async () => {
    const b = await base();
    for (const set of [
      sql`folio = 999`,
      sql`cliente_id = cliente_id`,
      sql`descuento_lealtad_pct = 10`,
      sql`posicion_tarjeta = 5`,
      sql`ciclo_tarjeta = 2`,
      sql`cuenta_tarjeta = false`,
      sql`sin_lealtad_motivo = NULL`,
      sql`admin_id = admin_id`,
    ]) {
      const e = await capturar(() =>
        app((db) => db.execute(sql`UPDATE pedido SET ${set} WHERE id = ${b.pedidoId}`)),
      );
      expect(pgCode(e)).toBe('42501');
    }
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
      db.insert(vendedor).values({ nombre: 'Nelly', tipo: 'revendedora' }).returning({ id: vendedor.id }),
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
    expect(r.rows).toEqual([{ campo: 'vendedor', antes: 'Kazero', despues: 'Nelly' }]);
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

  it('R-11: kazero_app no puede cambiar los precios de una línea', async () => {
    const b = await base();
    await app((db) =>
      db
        .insert(pedidoItem)
        .values({ pedidoId: b.pedidoId, piezaId: b.piezaId, precioLista: '149.00', precioFinal: '149.00' }),
    );
    expect(
      pgCode(await capturar(() => app((db) => db.execute(sql`UPDATE pedido_item SET precio_lista = 1`)))),
    ).toBe('42501');
    expect(
      await codigoAl(() =>
        app((db) =>
          db.update(pedidoItem).set({ quitadoAt: new Date() }).where(eq(pedidoItem.pedidoId, b.pedidoId)),
        ),
      ),
    ).toBe('pedido_item_quitado_coherente');
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
        db
          .insert(saldoFavorMov)
          .values({ clienteId: b.clienteId, tipo: 'cancelacion', monto: '50.00', fecha: '2026-10-11', ...v }),
      );
    expect(await codigoAl(() => mov({ vendedorId: b.vendedorId }))).toBe('saldo_favor_un_titular');
    expect(await codigoAl(() => mov({ monto: '-5.00' }))).toBe('saldo_favor_signo');
    await mov({ pedidoId: b.pedidoId });
    await mov({ monto: '20.00' });
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

describe('kz_auditar redefinida en 0013', () => {
  it('sigue SECURITY DEFINER, con search_path fijo y sin EXECUTE para PUBLIC ni kazero_app', async () => {
    const r = await owner((db) =>
      db.execute<{ definer: boolean; config: string[] | null; app: boolean; publico: boolean }>(sql`
        SELECT p.prosecdef AS definer, p.proconfig AS config,
               has_function_privilege('kazero_app', p.oid, 'EXECUTE') AS app,
               EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
        FROM pg_proc p WHERE p.oid = 'public.kz_auditar()'::regprocedure`),
    );
    expect(r.rows).toEqual([
      { definer: true, config: ['search_path=pg_catalog, public, pg_temp'], app: false, publico: false },
    ]);
  });

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
