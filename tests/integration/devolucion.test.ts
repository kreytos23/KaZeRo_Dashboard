import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { movimientoPieza, pedido, vPedido, vPedidoItem } from '@/db/schema';
import { crearCliente } from '@/server/clientes/servicio';
import { traducirErrorPg } from '@/server/errores';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { devolverPiezaDefectuosa } from '@/server/pedidos/devolucion';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza, cambiarEstado, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { movimientosSaldoFavor, saldoFavorDeCliente } from '@/server/saldo-favor/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let ctx: { clienteId: string; vendedorId: string };

async function alta(codigo: string, precioCentavos: number) {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Aretes',
      descripcion: `Arete ${codigo}`,
      costoCentavos: 0,
      precioCentavos,
    }),
  );
}
const abrir = (codigos: string[], descuentoManualCentavos = 0) =>
  app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      ...ctx,
      codigos,
      cuentaTarjeta: true,
      descuentoManualCentavos,
      descuentoManualMotivo: descuentoManualCentavos ? 'Promoción' : undefined,
    }),
  );
const pagar = (pedidoId: string, montoCentavos: number, metodo: 'efectivo' | 'saldo_favor' = 'efectivo') =>
  app((db) =>
    registrarPagoDePedido(db, {
      key: randomUUID(),
      adminId,
      pedidoId,
      montoCentavos,
      metodo,
      pagador: 'cliente',
    }),
  );
/** Pedido con las piezas dadas, pagado completo en efectivo (liquidado) salvo `liquidar: false`. */
async function pedidoCon(piezas: [string, number][], descuentoManualCentavos = 0, liquidar = true) {
  for (const [c, p] of piezas) await alta(c, p);
  const r = await abrir(
    piezas.map(([c]) => c),
    descuentoManualCentavos,
  );
  if (liquidar) await pagar(r.id, piezas.reduce((s, [, p]) => s + p, 0) - descuentoManualCentavos);
  return r;
}
const itemDe = async (pedidoId: string, codigo: string) =>
  (await app((db) => db.select().from(vPedidoItem).where(eq(vPedidoItem.pedidoId, pedidoId)))).find(
    (i) => i.codigo === codigo,
  )!;
const devolver = (
  pedidoId: string,
  itemId: string,
  extra: Partial<Parameters<typeof devolverPiezaDefectuosa>[1]> = {},
) =>
  app((db) =>
    devolverPiezaDefectuosa(db, {
      key: randomUUID(),
      adminId,
      pedidoId,
      itemId,
      motivo: 'Se rompió el broche',
      ...extra,
    }),
  );
const ficha = (id: string) =>
  app(async (db) => (await db.select().from(vPedido).where(eq(vPedido.id, id)))[0]!);
const saldo = () => app((db) => saldoFavorDeCliente(db, ctx.clienteId));

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  ctx = {
    vendedorId: await app((db) =>
      crearVendedor(db, { nombre: 'Perla', tipo: 'revendedora', comisionPct: '18.00' }),
    ),
    clienteId: await app((db) => crearCliente(db, { nombre: 'Clienta' })),
  };
});

describe('devolverPiezaDefectuosa', () => {
  it('devuelve la línea a saldo a favor: el pedido sigue liquidado y la pieza queda en defecto', async () => {
    const p = await pedidoCon([
      ['DV01', 30000],
      ['DV02', 10000],
    ]);
    const antes = await ficha(p.id);
    const item = await itemDe(p.id, 'DV02');
    const r = await devolver(p.id, item.id);
    expect(r).toEqual({ montoAFavor: '100.00', saldoFavor: '100.00' });
    expect(await ficha(p.id)).toMatchObject({
      estado: 'liquidado',
      total: antes.total,
      pagado: antes.pagado,
      saldo: '0.00',
      devuelto: '100.00',
    });
    expect(await itemDe(p.id, 'DV02')).toMatchObject({
      vigente: false,
      quitadoAt: null,
      devolucionMotivo: 'Se rompió el broche',
      devolucionMonto: '100.00',
    });
    expect((await itemDe(p.id, 'DV02')).devolucionFecha).toBeTruthy();
    const pz = await app((db) => obtenerPiezaPorCodigo(db, 'DV02'));
    expect(pz?.estado).toBe('defecto');
    const movs = await app((db) =>
      db.select().from(movimientoPieza).where(eq(movimientoPieza.piezaId, pz!.id)),
    );
    expect(movs.filter((m) => m.tipo === 'devolucion')).toMatchObject([
      {
        deEstado: 'vendida',
        aEstado: 'defecto',
        pedidoId: p.id,
        adminId,
        nota: expect.stringContaining('Se rompió el broche'),
      },
    ]);
    const libro = await app((db) => movimientosSaldoFavor(db, { clienteId: ctx.clienteId }));
    expect(libro).toMatchObject([{ tipo: 'devolucion', monto: '100.00', pedidoId: p.id, adminId }]);
    expect(libro[0]!.devolucionId).toBeTruthy();
    expect(await saldo()).toBe('100.00');
  });

  it('P3: prorratea el descuento manual; la suma de lo devuelto es el total', async () => {
    const p = await pedidoCon(
      [
        ['DV11', 30000],
        ['DV12', 10000],
      ],
      4000,
    );
    expect((await devolver(p.id, (await itemDe(p.id, 'DV11')).id)).montoAFavor).toBe('270.00');
    expect((await devolver(p.id, (await itemDe(p.id, 'DV12')).id)).montoAFavor).toBe('90.00');
    expect(await saldo()).toBe('360.00');
    expect(await ficha(p.id)).toMatchObject({ total: '360.00', devuelto: '360.00', estado: 'liquidado' });
  });

  it('la pieza reparada y pasada a disponible entra a un pedido nuevo (R-05)', async () => {
    const p = await pedidoCon([['DV21', 15000]]);
    await devolver(p.id, (await itemDe(p.id, 'DV21')).id);
    const pz = (await app((db) => obtenerPiezaPorCodigo(db, 'DV21')))!;
    await app((db) =>
      cambiarEstado(db, { piezaId: pz.id, version: pz.version, aEstado: 'disponible', adminId }),
    );
    const nuevo = await abrir(['DV21']);
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'DV21')))?.estado).toBe('apartada');
    expect(nuevo.id).not.toBe(p.id);
  });

  it('D-7: la tarjeta no cambia (mismo lugar, mismas ocupadas)', async () => {
    const p = await pedidoCon([['DV31', 10000]]);
    const lugares = () =>
      app((db) =>
        db
          .select({ ciclo: pedido.cicloTarjeta, pos: pedido.posicionTarjeta, estado: pedido.estado })
          .from(pedido)
          .where(eq(pedido.clienteId, ctx.clienteId)),
      );
    const antes = await lugares();
    await devolver(p.id, (await itemDe(p.id, 'DV31')).id);
    expect(await lugares()).toEqual(antes);
  });

  it('rechaza pedido abierto, línea ajena, fecha inválida, motivo vacío y segunda devolución', async () => {
    const abierto = await pedidoCon([['DV41', 10000]], 0, false);
    await expect(devolver(abierto.id, (await itemDe(abierto.id, 'DV41')).id)).rejects.toMatchObject({
      message:
        'Solo se devuelven piezas de pedidos liquidados. Si el pedido está abierto, quita la pieza al editarlo.',
    });
    const p = await pedidoCon([
      ['DV42', 10000],
      ['DV43', 5000],
    ]);
    const item = await itemDe(p.id, 'DV42');
    await expect(devolver(p.id, randomUUID())).rejects.toMatchObject({
      message: 'La línea no es de este pedido.',
    });
    await expect(devolver(p.id, (await itemDe(abierto.id, 'DV41')).id)).rejects.toMatchObject({
      message: 'La línea no es de este pedido.',
    });
    await expect(devolver(p.id, item.id, { fecha: '2000-01-01' })).rejects.toMatchObject({
      message: 'La fecha de la devolución no puede ser anterior a la del pedido.',
      campo: 'fecha',
    });
    await expect(devolver(p.id, item.id, { fecha: '2999-01-01' })).rejects.toMatchObject({
      campo: 'fecha',
    });
    await expect(devolver(p.id, item.id, { motivo: '   ' })).rejects.toMatchObject({
      message: 'Escribe el motivo de la devolución (hasta 200 caracteres).',
      campo: 'motivo',
    });
    await devolver(p.id, item.id);
    await expect(devolver(p.id, item.id)).rejects.toMatchObject({ message: 'Esa pieza ya se devolvió.' });
    expect(await saldo()).toBe('100.00');
  });

  it('es idempotente: la misma key produce un solo efecto y el mismo resultado', async () => {
    const p = await pedidoCon([['DV51', 10000]]);
    const item = await itemDe(p.id, 'DV51');
    const key = randomUUID();
    const a = await devolver(p.id, item.id, { key });
    const b = await devolver(p.id, item.id, { key });
    expect(b).toEqual(a);
    expect(await saldo()).toBe('100.00');
    const n = await app((db) => db.execute(sql`SELECT count(*)::int AS n FROM devolucion`));
    expect(n.rows[0]!['n']).toBe(1);
  });

  it('pagado con saldo a favor y efectivo: regresa el monto completo de la línea a saldo', async () => {
    // Saldo previo de $60: pedido abierto con $60 abonados y cancelado.
    const previo = await pedidoCon([['DV60', 7000]], 0, false);
    await pagar(previo.id, 6000);
    await app((db) =>
      cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: previo.id, version: 1, motivo: 'Prueba' }),
    );
    expect(await saldo()).toBe('60.00');
    const p = await pedidoCon([['DV62', 10000]], 0, false);
    await pagar(p.id, 6000, 'saldo_favor');
    await pagar(p.id, 4000); // otro monto que el abono previo: no es un posible duplicado
    expect(await saldo()).toBe('0.00');
    expect(await devolver(p.id, (await itemDe(p.id, 'DV62')).id)).toEqual({
      montoAFavor: '100.00',
      saldoFavor: '100.00',
    });
    const suma = await app((db) =>
      db.execute(
        sql`SELECT coalesce(sum(monto), 0)::text AS s FROM saldo_favor_mov WHERE cliente_id = ${ctx.clienteId}`,
      ),
    );
    expect(suma.rows[0]!['s']).toBe('100.00');
  });

  it('sin el servicio no hay atajo: vendida → defecto a mano lo rechaza la BD', async () => {
    const p = await pedidoCon([['DV71', 10000]]);
    const e = await app((db) =>
      db.execute(sql`UPDATE pieza SET estado = 'defecto' WHERE codigo = 'DV71'`).then(
        () => null,
        (x: unknown) => x,
      ),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('pieza_transicion');
    expect((await ficha(p.id)).devuelto).toBe('0.00');
  });

  it('inconsistente: si la pieza de la línea ya no está vendida se rechaza y no se escribe nada', async () => {
    const p = await pedidoCon([['DV81', 10000]]);
    const item = await itemDe(p.id, 'DV81');
    // Solo con triggers apagados (rol dueño) se puede dejar la pieza fuera de `vendida`.
    await conDbUrl(urlOwner(), (db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE pieza DISABLE TRIGGER USER`);
        await tx.execute(sql`UPDATE pieza SET estado = 'disponible' WHERE codigo = 'DV81'`);
        await tx.execute(sql`ALTER TABLE pieza ENABLE TRIGGER USER`);
      }),
    );
    await expect(devolver(p.id, item.id)).rejects.toMatchObject({
      codigo: 'inconsistente',
      message: 'La pieza DV81 no está vendida (disponible). Recarga la página.',
    });
    expect(await saldo()).toBe('0.00');
    expect(await itemDe(p.id, 'DV81')).toMatchObject({ vigente: true, devolucionId: null });
  });

  it('rechaza con su propio mensaje (sin campo) cuando el descuento del pedido cubrió el precio de la línea', async () => {
    // Líneas $100 y $1 con $100.50 de descuento: la parte de la de $1 es $1.00, así que le quedan $0.
    const p = await pedidoCon(
      [
        ['DV91', 10000],
        ['DV92', 100],
      ],
      10050,
    );
    const e = await devolver(p.id, (await itemDe(p.id, 'DV92')).id).catch((x: unknown) => x);
    expect(e).toMatchObject({
      codigo: 'sin_monto_devolver',
      message: 'Esta pieza no tiene monto por devolver: el descuento del pedido cubrió su precio.',
    });
    expect((e as { campo?: string }).campo).toBeUndefined();
    expect(await saldo()).toBe('0.00');
    expect(await itemDe(p.id, 'DV92')).toMatchObject({ vigente: true });
  });
});
