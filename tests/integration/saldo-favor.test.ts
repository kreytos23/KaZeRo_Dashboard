import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { vAplicacionPago, vPedido } from '@/db/schema';
import { crearCliente } from '@/server/clientes/servicio';
import { registrarPagoDePedido, type DatosPagoPedido } from '@/server/pagos/servicio';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { movimientosSaldoFavor, retirarSaldoFavor, saldoFavorDeCliente } from '@/server/saldo-favor/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let ctx: { clienteId: string; vendedorId: string };

async function pedidoCon(codigo: string, precioCentavos: number) {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Aretes',
      descripcion: `Arete ${codigo}`,
      costoCentavos: 0,
      precioCentavos,
    }),
  );
  return app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      ...ctx,
      codigos: [codigo],
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
    }),
  );
}
const pagar = (pedidoId: string, montoCentavos: number, extra: Partial<DatosPagoPedido> = {}) =>
  app((db) =>
    registrarPagoDePedido(db, {
      key: randomUUID(),
      adminId,
      pedidoId,
      montoCentavos,
      metodo: 'transferencia',
      pagador: 'cliente',
      ...extra,
    }),
  );
const conSaldo = (pedidoId: string, montoCentavos: number, extra: Partial<DatosPagoPedido> = {}) =>
  pagar(pedidoId, montoCentavos, { metodo: 'saldo_favor', ...extra });
const cancelar = (pedidoId: string) =>
  app((db) => cancelarPedido(db, { key: randomUUID(), adminId, pedidoId, version: 1, motivo: 'Prueba' }));
const retirar = (montoCentavos: number, nota = 'Entregado en efectivo', key: string = randomUUID()) =>
  app((db) => retirarSaldoFavor(db, { key, adminId, clienteId: ctx.clienteId, montoCentavos, nota }));
const saldo = () => app((db) => saldoFavorDeCliente(db, ctx.clienteId));
const ficha = (id: string) =>
  app(async (db) => (await db.select().from(vPedido).where(eq(vPedido.id, id)))[0]!);
const libro = async () =>
  (
    await app((db) =>
      db.execute(
        sql`SELECT coalesce(sum(monto), 0)::text AS s FROM saldo_favor_mov WHERE cliente_id = ${ctx.clienteId}`,
      ),
    )
  ).rows[0]!['s'];

/** Deja $149 de saldo: pedido de $200 con $149 abonados y cancelado (R-17). */
async function prepararSaldo149() {
  const a = await pedidoCon('SA01', 20000);
  await pagar(a.id, 14900);
  await cancelar(a.id);
}

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  ctx = {
    vendedorId: await app((db) =>
      crearVendedor(db, { nombre: 'Perla', tipo: 'revendedora', comisionPct: '18.00' }),
    ),
    clienteId: await app((db) => crearCliente(db, { nombre: 'Clienta' })),
  };
});

describe('pagar con saldo a favor', () => {
  it('parcial: el pedido sigue abierto, baja el saldo y el uso queda en el libro con su aplicación y admin', async () => {
    await prepararSaldo149();
    expect(await saldo()).toBe('149.00');
    const b = await pedidoCon('SB01', 20000);
    const r = await conSaldo(b.id, 10000);
    expect(r).toMatchObject({ estado: 'abierto', saldo: '100.00' });
    expect(await ficha(b.id)).toMatchObject({ estado: 'abierto', pagado: '100.00', saldo: '100.00' });
    expect(await saldo()).toBe('49.00');
    const [ap] = await app((db) =>
      db.select().from(vAplicacionPago).where(eq(vAplicacionPago.pedidoId, b.id)),
    );
    expect(ap).toMatchObject({ metodo: 'saldo_favor', monto: '100.00', pagadorTipo: 'cliente' });
    const usos = await app((db) =>
      db.execute(
        sql`SELECT monto::text, aplicacion_pago_id, admin_id, pedido_id FROM saldo_favor_mov WHERE tipo::text = 'uso'`,
      ),
    );
    expect(usos.rows).toEqual([
      { monto: '-100.00', aplicacion_pago_id: ap!.id, admin_id: adminId, pedido_id: b.id },
    ]);
  });

  it('total: si el saldo cubre el pedido, lo liquida y la pieza queda vendida', async () => {
    await prepararSaldo149();
    const b = await pedidoCon('SB02', 10000);
    expect(await conSaldo(b.id, 10000)).toMatchObject({ estado: 'liquidado', saldo: '0.00' });
    expect(await ficha(b.id)).toMatchObject({ estado: 'liquidado' });
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'SB02')))?.estado).toBe('vendida');
    expect(await saldo()).toBe('49.00');
  });

  it('rechaza más que el saldo, más que el saldo del pedido y a un pagador vendedor sin saldo; no escribe nada', async () => {
    await prepararSaldo149();
    const b = await pedidoCon('SB03', 20000);
    await expect(conSaldo(b.id, 15000)).rejects.toMatchObject({
      codigo: 'saldo_insuficiente',
      campo: 'monto',
      message: 'El saldo a favor ($149.00) no alcanza para $150.00.',
    });
    await expect(conSaldo(b.id, 30000)).rejects.toMatchObject({ codigo: 'pago_excede' });
    // Plan 4b (P-2): la vendedora también paga con su saldo; sin sobrante suyo no alcanza (no usa el de la clienta).
    await expect(conSaldo(b.id, 1000, { pagador: 'vendedor' })).rejects.toMatchObject({
      codigo: 'saldo_insuficiente',
      campo: 'monto',
      message: 'El saldo a favor ($0.00) no alcanza para $10.00.',
    });
    expect(await saldo()).toBe('149.00');
    expect(await ficha(b.id)).toMatchObject({ pagado: '0.00', saldo: '200.00' });
    const n = await app((db) =>
      db.execute(sql`SELECT count(*)::int AS n FROM pago WHERE metodo::text = 'saldo_favor'`),
    );
    expect(n.rows[0]).toEqual({ n: 0 });
  });

  it('sin saldo alguno también es saldo_insuficiente', async () => {
    const b = await pedidoCon('SB04', 20000);
    await expect(conSaldo(b.id, 100)).rejects.toMatchObject({
      codigo: 'saldo_insuficiente',
      message: 'El saldo a favor ($0.00) no alcanza para $1.00.',
    });
  });

  it('idempotencia: repetir la misma llave no usa el saldo dos veces', async () => {
    await prepararSaldo149();
    const b = await pedidoCon('SB05', 20000);
    const key = randomUUID();
    const r1 = await conSaldo(b.id, 5000, { key });
    const r2 = await conSaldo(b.id, 5000, { key });
    expect(r2).toEqual(r1);
    expect(await saldo()).toBe('99.00');
  });

  it('cancelar un pedido pagado con saldo devuelve el saldo (cancelacion con admin); el libro cuadra', async () => {
    await prepararSaldo149();
    const b = await pedidoCon('SB06', 20000);
    await conSaldo(b.id, 10000);
    expect(await saldo()).toBe('49.00');
    expect(await cancelar(b.id)).toMatchObject({ saldoFavor: '100.00' });
    expect(await saldo()).toBe('149.00');
    expect(await libro()).toBe('149.00');
    const c = await app((db) =>
      db.execute(
        sql`SELECT admin_id FROM saldo_favor_mov WHERE tipo::text = 'cancelacion' AND pedido_id = ${b.id}`,
      ),
    );
    expect(c.rows).toEqual([{ admin_id: adminId }]);
  });
});

describe('retirarSaldoFavor', () => {
  it('con nota: baja el saldo y deja el retiro con nota y admin', async () => {
    await prepararSaldo149();
    expect(await retirar(5000, '  Se entregó en efectivo  ')).toEqual({ saldo: '99.00' });
    expect(await saldo()).toBe('99.00');
    const r = await app((db) =>
      db.execute(
        sql`SELECT monto::text, nota, admin_id, pedido_id FROM saldo_favor_mov WHERE tipo::text = 'retiro'`,
      ),
    );
    expect(r.rows).toEqual([
      { monto: '-50.00', nota: 'Se entregó en efectivo', admin_id: adminId, pedido_id: null },
    ]);
  });

  it('valida monto y nota, y no deja retirar más que el saldo', async () => {
    await prepararSaldo149();
    await expect(retirar(0)).rejects.toMatchObject({
      codigo: 'monto_invalido',
      message: 'El monto debe ser mayor que cero.',
    });
    await expect(retirar(1000, '   ')).rejects.toMatchObject({
      codigo: 'nota_invalida',
      campo: 'nota',
      message: 'Escribe una nota del retiro (hasta 200 caracteres).',
    });
    await expect(retirar(1000, 'x'.repeat(201))).rejects.toMatchObject({ campo: 'nota' });
    await expect(retirar(15000)).rejects.toMatchObject({
      codigo: 'saldo_insuficiente',
      campo: 'monto',
      message: 'El saldo a favor ($149.00) no alcanza para $150.00.',
    });
    expect(await saldo()).toBe('149.00');
  });

  it('idempotencia: misma llave dos veces = un retiro; otra cantidad con la misma llave es error', async () => {
    await prepararSaldo149();
    const key = randomUUID();
    const r1 = await retirar(4000, 'Efectivo', key);
    const r2 = await retirar(4000, 'Efectivo', key);
    expect(r2).toEqual(r1);
    expect(await saldo()).toBe('109.00');
    await expect(retirar(5000, 'Efectivo', key)).rejects.toMatchObject({
      codigo: 'idempotencia',
      message: expect.stringContaining('otros datos'),
    });
    expect(await saldo()).toBe('109.00');
  });

  it('concurrencia: retirar todo y pagar con todo a la vez, solo uno pasa y el saldo queda en 0', async () => {
    await prepararSaldo149();
    const b = await pedidoCon('SC01', 20000);
    const rs = await Promise.allSettled([retirar(14900), conSaldo(b.id, 14900)]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await saldo()).toBe('0.00');
    expect(await libro()).toBe('0.00');
  });
});

describe('movimientosSaldoFavor', () => {
  it('lista el historial, el más reciente primero, con folio, nota y admin', async () => {
    await prepararSaldo149();
    const b = await pedidoCon('SD01', 20000);
    await conSaldo(b.id, 5000);
    await retirar(2000, 'Efectivo');
    const movs = await app((db) => movimientosSaldoFavor(db, { clienteId: ctx.clienteId }));
    expect(movs.map((m) => m.tipo)).toEqual(['retiro', 'uso', 'cancelacion']);
    expect(movs[0]).toMatchObject({ monto: '-20.00', nota: 'Efectivo', adminId, pedidoFolio: null });
    expect(movs[1]).toMatchObject({ monto: '-50.00', pedidoFolio: b.folio, adminId });
    expect(movs[2]).toMatchObject({ monto: '149.00', adminId });
    const uno = await app((db) => movimientosSaldoFavor(db, { clienteId: ctx.clienteId, limite: 1 }));
    expect(uno).toHaveLength(1);
  });

  it('desempata de forma estable las filas de una misma transacción (mayor monto primero)', async () => {
    const a = await pedidoCon('SH01', 100000);
    await pagar(a.id, 10000);
    await pagar(a.id, 30000);
    await pagar(a.id, 20000);
    await cancelar(a.id); // tres `cancelacion` con el mismo created_at
    const orden = async () =>
      (await app((db) => movimientosSaldoFavor(db, { clienteId: ctx.clienteId }))).map((m) => m.monto);
    expect(await orden()).toEqual(['300.00', '200.00', '100.00']);
    expect(await orden()).toEqual(['300.00', '200.00', '100.00']);
  });
});
