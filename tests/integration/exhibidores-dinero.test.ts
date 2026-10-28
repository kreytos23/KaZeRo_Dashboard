import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { cliente, entregaExhibidor, pago, pedido } from '@/db/schema';
import { hoyMX } from '@/domain/fechas';
import { crearCliente } from '@/server/clientes/servicio';
import { reporteComisiones } from '@/server/comisiones/lecturas';
import {
  clienteMostradorId,
  registrarAjusteExhibidor,
  registrarEntregaExhibidor,
  registrarVentaExhibidor,
} from '@/server/exhibidores/dinero';
import {
  cerrarExhibidor,
  crearExhibidor,
  enviarPiezas,
  obtenerExhibidor,
  regresarPiezas,
} from '@/server/exhibidores/servicio';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

// Plan 4a, Task 2: venta del exhibidor en un paso, cobros, entregas, ajustes y cierre (reglas E-1..E-8).
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let perlaId = '';
let rosaId = '';
let gloriaId = '';
let exhibidorId = '';

const PRECIO = 10000; // $100.00 por pieza

async function pieza(codigo: string) {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Aretes',
      descripcion: `Arete ${codigo}`,
      costoCentavos: 0,
      precioCentavos: PRECIO,
    }),
  );
}
async function enExhibidor(id: string, ...codigos: string[]) {
  for (const c of codigos) await pieza(c);
  await app((db) => enviarPiezas(db, { exhibidorId: id, codigos }));
}
const venta = (o: Partial<Parameters<typeof registrarVentaExhibidor>[1]> = {}) =>
  app((db) =>
    registrarVentaExhibidor(db, {
      key: randomUUID(),
      adminId,
      exhibidorId,
      codigos: ['EX01'],
      clienteId: null,
      cobradoCentavos: PRECIO,
      metodo: 'efectivo',
      ...o,
    }),
  );
const entrega = (montoCentavos: number, o: Partial<Parameters<typeof registrarEntregaExhibidor>[1]> = {}) =>
  app((db) =>
    registrarEntregaExhibidor(db, {
      key: randomUUID(),
      adminId,
      exhibidorId,
      montoCentavos,
      metodo: 'efectivo',
      ...o,
    }),
  );
const ajuste = (montoCentavos: number, motivo = 'Corrección de caja') =>
  app((db) =>
    registrarAjusteExhibidor(db, { key: randomUUID(), adminId, exhibidorId, montoCentavos, motivo }),
  );
const vista = async () => (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
const porEntregar = async () => (await vista()).porEntregar;
const falla = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as { codigo?: string; message: string; campo?: string },
  );

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  perlaId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla', tipo: 'revendedora', comisionPct: '18.00' }),
  );
  rosaId = await app((db) =>
    crearVendedor(db, { nombre: 'Rosa', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  gloriaId = await app((db) => crearCliente(db, { nombre: 'Gloria' }));
  exhibidorId = await app((db) =>
    crearExhibidor(db, { vendedorId: perlaId, nombre: 'Estética Luz', fechaEnvio: '2026-10-01' }),
  );
  await enExhibidor(exhibidorId, 'EX01', 'EX02', 'EX03');
});

describe('venta del exhibidor', () => {
  it('sin clienta: nota a Venta de mostrador, de la vendedora del exhibidor, sin tarjeta, cobrada y liquidada', async () => {
    const v = await venta();
    expect(v).toMatchObject({ estado: 'liquidado' });
    const [p] = await app((db) => db.select().from(pedido).where(eq(pedido.id, v.pedidoId)));
    const [mostrador] = await app((db) => db.select().from(cliente).where(eq(cliente.esMostrador, true)));
    expect(p).toMatchObject({
      clienteId: mostrador!.id,
      vendedorId: perlaId,
      cuentaTarjeta: false,
    });
    const [pg] = await app((db) => db.select().from(pago));
    expect(pg).toMatchObject({ exhibidorId, monto: '100.00', pagadorClienteId: mostrador!.id });
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'EX01')))!.estado).toBe('vendida');
    expect(await porEntregar()).toBe('100.00');
  });

  it('con clienta: la nota cuenta en su tarjeta', async () => {
    const v = await venta({ clienteId: gloriaId });
    const [p] = await app((db) => db.select().from(pedido).where(eq(pedido.id, v.pedidoId)));
    expect(p).toMatchObject({ clienteId: gloriaId, vendedorId: perlaId, cuentaTarjeta: true });
  });

  it('cobro parcial deja la nota abierta; un abono posterior marcado con el exhibidor suma al por entregar', async () => {
    const v = await venta({ cobradoCentavos: 4000 });
    expect(v.estado).toBe('abierto');
    expect(await porEntregar()).toBe('40.00');
    const r = await app((db) =>
      registrarPagoDePedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: v.pedidoId,
        montoCentavos: 6000,
        metodo: 'transferencia',
        pagador: 'cliente',
        exhibidorId,
      }),
    );
    expect(r.estado).toBe('liquidado');
    expect(await porEntregar()).toBe('100.00');
  });

  it('sin cobro (0): crea la nota abierta y no mueve el por entregar', async () => {
    const v = await venta({ cobradoCentavos: 0 });
    expect(v.estado).toBe('abierto');
    expect(await app((db) => db.select().from(pago))).toHaveLength(0);
    expect(await porEntregar()).toBe('0.00');
  });

  it('rechaza un cobro mayor al total y no deja nada (ni nota ni pieza vendida)', async () => {
    const e = await falla(venta({ cobradoCentavos: PRECIO + 1 }));
    expect(e).toMatchObject({ codigo: 'pago_excede', campo: 'cobrado' });
    expect(await app((db) => db.select().from(pedido))).toHaveLength(0);
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'EX01')))!.estado).toBe('en_exhibidor');
  });

  it('rechaza piezas de otro exhibidor o que no están en exhibidor, nombrándolas', async () => {
    const otro = await app((db) =>
      crearExhibidor(db, { vendedorId: rosaId, nombre: 'Otro', fechaEnvio: '2026-10-02' }),
    );
    await enExhibidor(otro, 'OT01');
    await pieza('DI01');
    const e = await falla(venta({ codigos: ['EX01', 'OT01', 'DI01'] }));
    expect(e).toMatchObject({ codigo: 'piezas_ajenas', campo: 'codigos' });
    expect(e!.message).toContain('OT01');
    expect(e!.message).toContain('DI01');
    expect(e!.message).not.toContain('EX01');
    expect(await app((db) => db.select().from(pedido))).toHaveLength(0);
  });

  it('rechaza un exhibidor cerrado y un abono con exhibidor de otra vendedora', async () => {
    const v = await venta({ cobradoCentavos: 0 });
    const deRosa = await app((db) =>
      crearExhibidor(db, { vendedorId: rosaId, nombre: 'De Rosa', fechaEnvio: '2026-10-02' }),
    );
    const e = await falla(
      app((db) =>
        registrarPagoDePedido(db, {
          key: randomUUID(),
          adminId,
          pedidoId: v.pedidoId,
          montoCentavos: 1000,
          metodo: 'efectivo',
          pagador: 'cliente',
          exhibidorId: deRosa,
        }),
      ),
    );
    expect(e).toMatchObject({ codigo: 'exhibidor_ajeno' });
    const vacio = await app((db) =>
      crearExhibidor(db, { vendedorId: perlaId, nombre: 'Vacío', fechaEnvio: '2026-10-03' }),
    );
    const ver = (await app((db) => obtenerExhibidor(db, vacio)))!.version;
    await app((db) => cerrarExhibidor(db, { exhibidorId: vacio, version: ver }));
    expect(await falla(venta({ exhibidorId: vacio }))).toMatchObject({ codigo: 'exhibidor_cerrado' });
  });

  it('un abono cobrado por un exhibidor cerrado se rechaza', async () => {
    const v = await venta({ cobradoCentavos: 0 });
    const vacio = await app((db) =>
      crearExhibidor(db, { vendedorId: perlaId, nombre: 'Cerrado', fechaEnvio: '2026-10-03' }),
    );
    const ver = (await app((db) => obtenerExhibidor(db, vacio)))!.version;
    await app((db) => cerrarExhibidor(db, { exhibidorId: vacio, version: ver }));
    const e = await falla(
      app((db) =>
        registrarPagoDePedido(db, {
          key: randomUUID(),
          adminId,
          pedidoId: v.pedidoId,
          montoCentavos: 1000,
          metodo: 'efectivo',
          pagador: 'cliente',
          exhibidorId: vacio,
        }),
      ),
    );
    expect(e).toMatchObject({ codigo: 'exhibidor_cerrado', campo: 'exhibidorId' });
  });

  it('un abono con exhibidor y pagador vendedor se rechaza; la venta valida el método aun sin cobro', async () => {
    const v = await venta({ cobradoCentavos: 0 });
    const e = await falla(
      app((db) =>
        registrarPagoDePedido(db, {
          key: randomUUID(),
          adminId,
          pedidoId: v.pedidoId,
          montoCentavos: 1000,
          metodo: 'efectivo',
          pagador: 'vendedor',
          exhibidorId,
        }),
      ),
    );
    expect(e).toMatchObject({ codigo: 'pagador_invalido', campo: 'pagador' });
    expect(await falla(venta({ cobradoCentavos: 0, metodo: 'saldo_favor' }))).toMatchObject({
      codigo: 'metodo_invalido',
    });
  });

  it('un abono con exhibidor y método saldo_favor se rechaza con mensaje claro', async () => {
    const v = await venta({ cobradoCentavos: 0 });
    const e = await falla(
      app((db) =>
        registrarPagoDePedido(db, {
          key: randomUUID(),
          adminId,
          pedidoId: v.pedidoId,
          montoCentavos: 1000,
          metodo: 'saldo_favor',
          pagador: 'cliente',
          exhibidorId,
        }),
      ),
    );
    expect(e).toMatchObject({ codigo: 'metodo_invalido' });
  });

  it('una nota a «Venta de mostrador» fuera del exhibidor se rechaza', async () => {
    await pieza('MS01');
    const mostradorId = await app((db) => clienteMostradorId(db));
    const e = await falla(
      app((db) =>
        crearPedido(db, {
          key: randomUUID(),
          adminId,
          clienteId: mostradorId,
          vendedorId: perlaId,
          codigos: ['MS01'],
          cuentaTarjeta: false,
          descuentoManualCentavos: 0,
        }),
      ),
    );
    expect(e).toMatchObject({ codigo: 'mostrador_fuera_de_exhibidor', campo: 'cliente' });
  });
  it('idempotente: la misma key no duplica nota ni cobro', async () => {
    const key = randomUUID();
    const a = await venta({ key });
    const b = await venta({ key });
    expect(b).toEqual(a);
    expect(await app((db) => db.select().from(pedido))).toHaveLength(1);
    expect(await app((db) => db.select().from(pago))).toHaveLength(1);
  });

  it('la venta liquidada del mes en curso entra en la comisión estimada de la vendedora', async () => {
    const v = await venta();
    const hoy = hoyMX();
    const rep = await app((db) => reporteComisiones(db, `${hoy.slice(0, 7)}-01`, { hoy }));
    const perla = rep.vendedoras.find((x) => x.vendedorId === perlaId)!;
    expect(perla.pedidosDetalle).toMatchObject([
      { pedidoId: v.pedidoId, baseCentavos: PRECIO, montoCentavos: 1800 },
    ]);
  });
});

describe('entregas, ajustes y cierre', () => {
  it('entrega parcial resta; una entrega mayor al por entregar falla con el mensaje y el campo', async () => {
    await venta({ codigos: ['EX01'] });
    await venta({ codigos: ['EX02'] });
    expect(await entrega(15000)).toEqual({ porEntregar: '50.00' });
    const e = await falla(entrega(5001));
    expect(e).toMatchObject({
      codigo: 'excede',
      campo: 'monto',
      message: 'El exhibidor tiene $50.00 por entregar; no puedes registrar $50.01.',
    });
    expect(await porEntregar()).toBe('50.00');
  });

  it('ajuste positivo suma y negativo resta, con motivo; el negativo no puede dejar el por entregar bajo cero', async () => {
    await venta();
    expect(await ajuste(2500)).toEqual({ porEntregar: '125.00' });
    expect(await ajuste(-3000)).toEqual({ porEntregar: '95.00' });
    expect(await falla(ajuste(-9501))).toMatchObject({ codigo: 'excede' });
    expect(await falla(ajuste(0))).toMatchObject({ campo: 'monto' });
    expect(await falla(ajuste(100, '  '))).toMatchObject({ campo: 'motivo' });
    expect(await falla(ajuste(100, null as unknown as string))).toMatchObject({
      codigo: 'motivo_invalido',
      campo: 'motivo',
    });
  });

  it('entrega o ajuste sobre un exhibidor cerrado se rechaza con mensaje claro', async () => {
    await regresarPiezas_y_cerrar();
    expect(await falla(entrega(100))).toMatchObject({ codigo: 'exhibidor_cerrado' });
    expect(await falla(ajuste(100))).toMatchObject({ codigo: 'exhibidor_cerrado' });
  });

  it('cancelar la venta no cambia el por entregar (lo cobrado no se des-cobra)', async () => {
    await venta(); // liquidada: un pedido liquidado no se cancela, así que se cancela otra abierta
    const w = await venta({ codigos: ['EX02'], cobradoCentavos: 3000 });
    const [q] = await app((db) => db.select().from(pedido).where(eq(pedido.id, w.pedidoId)));
    const antes = await porEntregar();
    await app((db) =>
      cancelarPedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: w.pedidoId,
        version: q!.version,
        motivo: 'Se arrepintió',
      }),
    );
    expect(await porEntregar()).toBe(antes);
    expect(antes).toBe('130.00');
  });

  it('cerrar con dinero por entregar se bloquea con el monto; al entregarlo todo y sin piezas se cierra', async () => {
    await venta();
    await app((db) => regresarPiezas(db, { exhibidorId, codigos: ['EX02', 'EX03'] }));
    const e = await falla(
      app(async (db) =>
        cerrarExhibidor(db, { exhibidorId, version: (await obtenerExhibidor(db, exhibidorId))!.version }),
      ),
    );
    expect(e).toMatchObject({
      codigo: 'dinero_pendiente',
      message: 'Antes de cerrar, registra la entrega de $100.00 que tiene por entregar.',
    });
    await entrega(10000);
    const v = await vista();
    await app((db) => cerrarExhibidor(db, { exhibidorId, version: v.version }));
    expect((await vista()).estado).toBe('cerrado');
  });

  it('idempotente: la misma key de entrega no resta dos veces', async () => {
    await venta();
    const key = randomUUID();
    const a = await entrega(3000, { key });
    const b = await entrega(3000, { key });
    expect(b).toEqual(a);
    expect(await app((db) => db.select().from(entregaExhibidor))).toHaveLength(1);
    expect(await porEntregar()).toBe('70.00');
  });

  it('dos entregas simultáneas que juntas exceden: una pasa y la otra falla', async () => {
    await venta();
    const rs = await Promise.allSettled([entrega(6000), entrega(6000)]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({ codigo: 'excede' });
    expect(await porEntregar()).toBe('40.00');
  });
});

async function regresarPiezas_y_cerrar() {
  await app((db) => regresarPiezas(db, { exhibidorId, codigos: ['EX01', 'EX02', 'EX03'] }));
  const v = await vista();
  await app((db) => cerrarExhibidor(db, { exhibidorId, version: v.version }));
}
