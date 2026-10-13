import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { vAplicacionPago, vPedido } from '@/db/schema';
import { crearCliente } from '@/server/clientes/servicio';
import {
  cerrarExhibidor,
  crearExhibidor,
  enviarPiezas,
  obtenerExhibidor,
} from '@/server/exhibidores/servicio';
import { registrarPagoDePedido, type DatosPagoPedido } from '@/server/pagos/servicio';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza, historial, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { adminDePrueba, truncarTodo, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let ctx: { clienteId: string; vendedorId: string };

async function pedidoCon(codigo: string, precioCentavos = 14900, fecha?: string) {
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
      fecha,
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
const ficha = (id: string) =>
  app(async (db) => (await db.select().from(vPedido).where(eq(vPedido.id, id)))[0]!);

beforeEach(async () => {
  await truncarTodo();
  adminId = await adminDePrueba();
  ctx = {
    vendedorId: await app((db) =>
      crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' }),
    ),
    clienteId: await app((db) => crearCliente(db, { nombre: 'Danya' })),
  };
});

describe('registrarPagoDePedido', () => {
  it('R-14/R-35: un abono baja el saldo y la aplicación lleva la fecha del pago', async () => {
    const p = await pedidoCon('PG01', 14900, '2026-09-30');
    expect(await pagar(p.id, 5000, { fecha: '2026-10-01' })).toMatchObject({
      estado: 'abierto',
      saldo: '99.00',
    });
    expect(await ficha(p.id)).toMatchObject({ estado: 'abierto', pagado: '50.00', saldo: '99.00' });
    const [ap] = await app((db) =>
      db.select().from(vAplicacionPago).where(eq(vAplicacionPago.pedidoId, p.id)),
    );
    expect(ap).toMatchObject({
      monto: '50.00',
      fecha: '2026-10-01',
      metodo: 'transferencia',
      pagadorTipo: 'cliente',
      pagadorNombre: 'Danya',
    });
  });

  it('R-15/R-20/R-25: el pago que deja saldo 0 liquida; la pieza de exhibidor queda vendida sin exhibidor', async () => {
    await app((db) =>
      altaPieza(db, {
        codigo: 'PG02',
        categoria: 'Aretes',
        descripcion: 'Arete',
        costoCentavos: 0,
        precioCentavos: 14900,
      }),
    );
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: 'Nelly 1', fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['PG02'] }));
    const p = await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        ...ctx,
        codigos: ['PG02'],
        cuentaTarjeta: true,
        descuentoManualCentavos: 0,
      }),
    );
    await pagar(p.id, 4900);
    expect(await pagar(p.id, 10000, { pagador: 'vendedor', metodo: 'efectivo' })).toMatchObject({
      estado: 'liquidado',
      saldo: '0.00',
    });
    expect(await ficha(p.id)).toMatchObject({ estado: 'liquidado', saldo: '0.00' });
    const pz = (await app((db) => obtenerPiezaPorCodigo(db, 'PG02')))!;
    expect(pz).toMatchObject({ estado: 'vendida', exhibidorId: null });
    expect((await app((db) => historial(db, pz.id)))[0]).toMatchObject({ tipo: 'venta', aEstado: 'vendida' });
    // Sin piezas ligadas, el exhibidor ya se puede cerrar.
    const e = (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
    await app((db) => cerrarExhibidor(db, { exhibidorId, version: e.version }));
  });

  it('el pago no puede exceder el saldo (el sobrante llega con el Plan 4)', async () => {
    const p = await pedidoCon('PG03');
    await expect(pagar(p.id, 20000)).rejects.toThrow(
      'El pago ($200.00) supera el saldo del pedido ($149.00).',
    );
  });

  it('no se paga un pedido liquidado', async () => {
    const p = await pedidoCon('PG04');
    await pagar(p.id, 14900);
    await expect(pagar(p.id, 100)).rejects.toThrow('El pedido ya está liquidado.');
  });

  it('dos pagos simultáneos que juntos exceden el saldo: solo uno pasa', async () => {
    const p = await pedidoCon('PG05');
    const r = await Promise.allSettled([pagar(p.id, 10000), pagar(p.id, 10000)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(
      ((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason as Error).message,
    ).toMatch(/supera el saldo/);
  });

  it('R-37: la misma key dos veces registra un solo pago', async () => {
    const p = await pedidoCon('PG06');
    const key = randomUUID();
    const [a, b] = await Promise.all([pagar(p.id, 1000, { key }), pagar(p.id, 1000, { key })]);
    expect(a).toEqual(b);
    expect(await ficha(p.id)).toMatchObject({ pagado: '10.00' });
  });

  it('valida monto, fecha, método y nota antes de escribir', async () => {
    const p = await pedidoCon('PG07');
    await expect(pagar(p.id, 0)).rejects.toThrow('El monto debe ser mayor que cero.');
    await expect(pagar(p.id, 100, { fecha: '2999-01-01' })).rejects.toThrow('La fecha no puede ser futura.');
    await expect(pagar(p.id, 100, { metodo: 'cheque' as never })).rejects.toThrow(
      'Elige un método de pago válido.',
    );
    await expect(pagar(p.id, 100, { nota: 'x'.repeat(201) })).rejects.toThrow(
      'La nota admite hasta 200 caracteres.',
    );
  });

  it('D-21: el pago guarda quién lo registró y la liquidación queda en la bitácora', async () => {
    const p = await pedidoCon('PG08');
    await pagar(p.id, 14900);
    const f = await app((db) =>
      db.execute(sql`SELECT
        (SELECT admin_id FROM pago LIMIT 1) AS registro,
        (SELECT count(*)::int FROM v_auditoria WHERE entidad = 'pedido' AND entidad_id = ${p.id} AND campo = 'estado' AND despues = 'liquidado') AS liquidaciones`),
    );
    expect(f.rows[0]).toEqual({ registro: adminId, liquidaciones: 1 });
  });

  it('R-23: la posición de tarjeta del pedido liquidado sigue contando para el siguiente', async () => {
    const p = await pedidoCon('PG10');
    await pagar(p.id, 14900);
    expect(await ficha(p.id)).toMatchObject({ estado: 'liquidado', cuentaTarjeta: true, posicionTarjeta: 1 });
    const q = await pedidoCon('PG11');
    expect((await ficha(q.id)).posicionTarjeta).toBe(2);
  });

  it('rechaza un pago con fecha anterior a la del pedido', async () => {
    const p = await pedidoCon('PG12', 14900, '2026-10-05');
    await expect(pagar(p.id, 100, { fecha: '2026-10-04' })).rejects.toThrow(
      'La fecha del pago no puede ser anterior a la del pedido.',
    );
    await pagar(p.id, 100, { fecha: '2026-10-05' });
  });

  it('rechaza el pago de un pedido cancelado', async () => {
    const p = await pedidoCon('PG13');
    const { version } = await ficha(p.id);
    await app((db) =>
      cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: p.id, version, motivo: 'x' }),
    );
    await expect(pagar(p.id, 100)).rejects.toThrow('El pedido está cancelado.');
  });

  it('R-37: la misma key con otros datos se rechaza', async () => {
    const p = await pedidoCon('PG14');
    const key = randomUUID();
    await pagar(p.id, 1000, { key });
    await expect(pagar(p.id, 2000, { key })).rejects.toThrow(
      'Este formulario ya se envió con otros datos. Recarga la página.',
    );
    expect(await ficha(p.id)).toMatchObject({ pagado: '10.00' });
  });
});
