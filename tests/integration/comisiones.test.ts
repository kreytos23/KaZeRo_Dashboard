import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { comisionLinea, vPedidoItem } from '@/db/schema';
import { comisionCentavos } from '@/domain/comisiones';
import { numericACentavos } from '@/domain/dinero';
import { crearCliente } from '@/server/clientes/servicio';
import { anularPagoComision, cerrarMesComisiones, registrarPagoComision } from '@/server/comisiones/servicio';
import { pendientesDeVendedora, reporteComisiones } from '@/server/comisiones/lecturas';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { devolverPiezaDefectuosa } from '@/server/pedidos/devolucion';
import { crearPedido } from '@/server/pedidos/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { actualizarVendedor, crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let nellyId = '';
let rosaId = '';
let clienteId = '';
let n = 0;

const datosPedido = (vendedorId: string) => ({
  key: randomUUID(),
  adminId,
  clienteId,
  vendedorId,
  cuentaTarjeta: false,
  descuentoManualCentavos: 0,
});

/** Pedido de una pieza liquidado con un solo cobro; `fecha` reescribe la fecha de cobro (el servicio no admite futuras). */
async function liquidado(precioCentavos: number, fecha: string, vendedorId = nellyId) {
  const codigo = `CM${String(++n).padStart(3, '0')}`;
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Aretes',
      descripcion: `Arete ${codigo}`,
      costoCentavos: 0,
      precioCentavos,
    }),
  );
  const p = await app((db) => crearPedido(db, { ...datosPedido(vendedorId), codigos: [codigo] }));
  await cobrar(p.id, precioCentavos, fecha);
  return { id: p.id, codigo };
}
async function cobrar(pedidoId: string, montoCentavos: number, fecha: string) {
  await app((db) =>
    registrarPagoDePedido(db, {
      key: randomUUID(),
      adminId,
      pedidoId,
      montoCentavos,
      metodo: 'efectivo',
      pagador: 'cliente',
    }),
  );
  // Solo con triggers apagados (rol dueño) se puede fechar un cobro en el futuro.
  await conDbUrl(urlOwner(), (db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE aplicacion_pago DISABLE TRIGGER USER`);
      await tx.execute(
        sql`UPDATE aplicacion_pago SET fecha = ${fecha}::date WHERE id = (SELECT id FROM aplicacion_pago WHERE pedido_id = ${pedidoId} ORDER BY created_at DESC LIMIT 1)`,
      );
      await tx.execute(sql`ALTER TABLE aplicacion_pago ENABLE TRIGGER USER`);
    }),
  );
}
const cerrar = (mes: string, hoy: string, key = randomUUID()) =>
  app((db) => cerrarMesComisiones(db, { key, adminId, mes, hoy }));
const reporte = (mes: string, hoy: string, vendedorId?: string) =>
  app((db) => reporteComisiones(db, mes, { hoy, vendedorId }));
const pagar = (corteId: string, vendedorId: string, key = randomUUID()) =>
  app((db) => registrarPagoComision(db, { key, adminId, corteId, vendedorId, metodo: 'efectivo' }));
const anular = (pagoId: string, motivo = 'Se pagó dos veces', key = randomUUID()) =>
  app((db) => anularPagoComision(db, { key, adminId, pagoId, motivo }));
const nelly = (rep: Awaited<ReturnType<typeof reporte>>) =>
  rep.vendedoras.find((v) => v.vendedorId === nellyId)!;

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  n = 0;
  nellyId = await app((db) =>
    crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' }),
  );
  rosaId = await app((db) =>
    crearVendedor(db, { nombre: 'Rosa', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  clienteId = await app((db) => crearCliente(db, { nombre: 'Danya' }));
});

describe('comisiones', () => {
  it('en curso: un pedido con abono parcial no aparece; al liquidarse entra con base, monto y % actual', async () => {
    await app((db) =>
      altaPieza(db, {
        codigo: 'CMX1',
        categoria: 'Aretes',
        descripcion: 'Arete',
        costoCentavos: 0,
        precioCentavos: 100000,
      }),
    );
    const p = await app((db) => crearPedido(db, { ...datosPedido(nellyId), codigos: ['CMX1'] }));
    await cobrar(p.id, 40000, '2026-10-10');
    expect((await reporte('2026-11-01', '2026-11-20')).numPedidos).toBe(0);
    await cobrar(p.id, 60000, '2026-11-05');
    const r = await reporte('2026-11-01', '2026-11-20');
    const v = nelly(r);
    expect(v.pedidosDetalle).toMatchObject([
      {
        pedidoId: p.id,
        baseCentavos: 100000,
        montoCentavos: 18000,
        pct: '18.00',
        fechaLiquidacion: '2026-11-05',
        vendedorNombre: 'Nelly',
        clienteNombre: 'Danya',
      },
    ]);
    expect(v.estadoPago).toBe('estimado');
    expect(r.cerrable).toBe(false);
  });

  it('cerrar: crea el corte con las líneas, el monto de cada línea es base × % y el mes cerrado lo repite', async () => {
    const p = await liquidado(100000, '2026-11-05');
    const c = await cerrar('2026-11-01', '2026-12-01');
    expect(c).toMatchObject({ mes: '2026-11-01', numPedidos: 1, totalCentavos: 18000 });
    const lineas = await app((db) =>
      db.select().from(comisionLinea).where(eq(comisionLinea.corteId, c.corteId)),
    );
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({ pedidoId: p.id, vendedorId: nellyId, pct: '18.00' });
    for (const l of lineas)
      expect(numericACentavos(l.monto)).toBe(comisionCentavos(numericACentavos(l.base), l.pct));
    const r = await reporte('2026-11-01', '2026-12-01');
    expect(r).toMatchObject({ cerrado: true, totalCentavos: 18000, numPedidos: 1, cerrable: false });
    expect(r.cerradoAt).toBeTruthy();
    expect(nelly(r)).toMatchObject({
      comisionCentavos: 18000,
      pct: '18.00',
      estadoPago: 'pendiente',
    });
  });

  it('% congelado: cambiar el % después del cierre no toca el mes cerrado; el mes en curso estima con el nuevo', async () => {
    await liquidado(100000, '2026-11-05');
    await cerrar('2026-11-01', '2026-12-01');
    await liquidado(100000, '2026-12-03');
    await app((db) =>
      actualizarVendedor(db, {
        id: nellyId,
        version: 1,
        adminId,
        motivo: 'Prueba',
        nombre: 'Nelly',
        tipo: 'revendedora',
        comisionPct: '20.00',
        activo: true,
      }),
    );
    expect(nelly(await reporte('2026-11-01', '2026-12-05')).comisionCentavos).toBe(18000);
    expect(nelly(await reporte('2026-12-01', '2026-12-05')).comisionCentavos).toBe(20000);
  });

  it('C-4: un pago atrasado de un pedido liquidado después del cierre entra en el mes siguiente', async () => {
    await liquidado(100000, '2026-11-05');
    await cerrar('2026-11-01', '2026-12-01');
    const tarde = await liquidado(50000, '2026-11-29');
    const dic = await reporte('2026-12-01', '2026-12-10');
    expect(nelly(dic).pedidosDetalle.map((d) => d.pedidoId)).toEqual([tarde.id]);
    const c = await cerrar('2026-12-01', '2027-01-01');
    expect(c).toMatchObject({ numPedidos: 1, totalCentavos: 9000 });
  });

  it('C-6: una devolución posterior no toca las líneas del corte ni reaparece en curso', async () => {
    const p = await liquidado(100000, '2026-11-05');
    const c = await cerrar('2026-11-01', '2026-12-01');
    const item = (await app((db) => db.select().from(vPedidoItem).where(eq(vPedidoItem.pedidoId, p.id))))[0]!;
    await app((db) =>
      devolverPiezaDefectuosa(db, {
        key: randomUUID(),
        adminId,
        pedidoId: p.id,
        itemId: item.id,
        motivo: 'Roto',
      }),
    );
    const dev = await app((db) =>
      db.execute(sql`SELECT count(*)::int AS n FROM devolucion WHERE pedido_item_id = ${item.id}`),
    );
    expect(dev.rows[0]!['n']).toBe(1);
    const cerrado = await reporte('2026-11-01', '2026-12-05');
    expect(cerrado.totalCentavos).toBe(18000);
    expect(c.totalCentavos).toBe(18000);
    expect((await reporte('2026-12-01', '2026-12-05')).numPedidos).toBe(0);
  });

  it('orden y fechas: fuera de orden, mes no terminado y ya cerrado (con la misma key repite el resultado)', async () => {
    await liquidado(100000, '2026-11-05');
    await expect(cerrar('2026-12-01', '2027-01-05')).rejects.toMatchObject({
      codigo: 'mes_fuera_de_orden',
      message: 'Primero cierra Noviembre 2026.',
    });
    await expect(cerrar('2026-11-01', '2026-11-30')).rejects.toMatchObject({
      codigo: 'mes_no_terminado',
      message: 'Noviembre 2026 termina el 30/11/2026; podrás cerrarlo desde el 01/12/2026.',
    });
    const key = randomUUID();
    const a = await cerrar('2026-11-01', '2026-12-01', key);
    expect(await cerrar('2026-11-01', '2026-12-01', key)).toEqual(a);
    await expect(cerrar('2026-11-01', '2026-12-01')).rejects.toMatchObject({
      codigo: 'ya_cerrado',
      message: 'Noviembre 2026 ya se cerró.',
    });
    await expect(cerrar('2026-11-15', '2026-12-01')).rejects.toMatchObject({ codigo: 'dato_invalido' });
  });

  it('concurrencia: dos cierres a la vez del mismo mes → uno gana y el otro es ya_cerrado, sin líneas duplicadas', async () => {
    await liquidado(100000, '2026-11-05');
    const r = await Promise.allSettled([
      cerrar('2026-11-01', '2026-12-01'),
      cerrar('2026-11-01', '2026-12-01'),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazo = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({ codigo: 'ya_cerrado' });
    const cuenta = await app((db) => db.execute(sql`SELECT count(*)::int AS n FROM comision_linea`));
    expect(cuenta.rows[0]!['n']).toBe(1);
  });

  it('carrera: dos pagos a la vez de la misma vendedora y corte (keys distintas) → uno OK y el otro ya_pagado', async () => {
    await liquidado(100000, '2026-11-05');
    const c = await cerrar('2026-11-01', '2026-12-01');
    const r = await Promise.allSettled([pagar(c.corteId, nellyId), pagar(c.corteId, nellyId)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazo = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({
      codigo: 'ya_pagado',
      message: 'La comisión de Nelly de Noviembre 2026 ya está pagada.',
    });
    const cuenta = await app((db) =>
      db.execute(sql`SELECT count(*)::int AS n FROM pago_comision WHERE anulado_at IS NULL`),
    );
    expect(cuenta.rows[0]!['n']).toBe(1);
  });

  it('mes sin pedidos: el corte queda con 0 líneas y la vendedora sin comisión', async () => {
    await liquidado(100000, '2026-10-05');
    await cerrar('2026-10-01', '2026-11-01');
    const c = await cerrar('2026-11-01', '2026-12-01');
    expect(c).toMatchObject({ numPedidos: 0, totalCentavos: 0 });
    const r = await reporte('2026-11-01', '2026-12-01', rosaId);
    expect(r.vendedoras).toMatchObject([{ vendedorId: rosaId, estadoPago: 'sin_comision', pedidos: 0 }]);
    await expect(pagar(c.corteId, rosaId)).rejects.toMatchObject({
      codigo: 'sin_comision',
      message: 'Rosa no tiene comisión en Noviembre 2026.',
    });
  });

  it('pago: registrar, doble envío, ya pagado, anular, anular otra vez y volver a pagar', async () => {
    await liquidado(100000, '2026-11-05');
    // En curso aún no hay corte.
    await expect(pagar(randomUUID(), nellyId)).rejects.toMatchObject({ codigo: 'no_encontrado' });
    const c = await cerrar('2026-11-01', '2026-12-01');
    const key = randomUUID();
    const p1 = await pagar(c.corteId, nellyId, key);
    expect(p1.montoCentavos).toBe(18000);
    expect(await pagar(c.corteId, nellyId, key)).toEqual(p1);
    await expect(pagar(c.corteId, nellyId)).rejects.toMatchObject({
      codigo: 'ya_pagado',
      message: 'La comisión de Nelly de Noviembre 2026 ya está pagada.',
    });
    let v = nelly(await reporte('2026-11-01', '2026-12-01'));
    expect(v.estadoPago).toBe('pagado');
    expect(v.pago).toMatchObject({ id: p1.pagoId, metodo: 'efectivo', montoCentavos: 18000, nota: null });
    expect(await app((db) => pendientesDeVendedora(db, nellyId))).toEqual([]);
    await expect(anular(p1.pagoId, '   ')).rejects.toMatchObject({
      codigo: 'motivo_invalido',
      campo: 'motivo',
      message: 'Escribe por qué se deshace el pago (hasta 200 caracteres).',
    });
    expect(await anular(p1.pagoId)).toEqual({ ok: true });
    await expect(anular(p1.pagoId)).rejects.toMatchObject({
      codigo: 'pago_anulado',
      message: 'Ese pago ya estaba deshecho.',
    });
    v = nelly(await reporte('2026-11-01', '2026-12-01'));
    expect(v.estadoPago).toBe('pendiente');
    expect((await pagar(c.corteId, nellyId)).montoCentavos).toBe(18000);
    expect(nelly(await reporte('2026-11-01', '2026-12-01')).estadoPago).toBe('pagado');
  });

  it('pago: valida método, nota y fecha', async () => {
    await liquidado(100000, '2026-11-05');
    const c = await cerrar('2026-11-01', '2026-12-01');
    const base = { key: randomUUID(), adminId, corteId: c.corteId, vendedorId: nellyId };
    await expect(app((db) => registrarPagoComision(db, { ...base, metodo: 'cheque' }))).rejects.toMatchObject(
      { codigo: 'metodo_invalido', campo: 'metodo' },
    );
    await expect(
      app((db) => registrarPagoComision(db, { ...base, metodo: 'efectivo', nota: 'x'.repeat(201) })),
    ).rejects.toMatchObject({ campo: 'nota' });
    await expect(
      app((db) => registrarPagoComision(db, { ...base, metodo: 'efectivo', fecha: '2999-01-01' })),
    ).rejects.toMatchObject({ campo: 'fecha', message: 'La fecha no puede ser futura.' });
  });

  it('pedido de total 0 liquidado sin cobros entra con base 0 y monto 0', async () => {
    await app((db) =>
      altaPieza(db, {
        codigo: 'CMZ1',
        categoria: 'Aretes',
        descripcion: 'Arete',
        costoCentavos: 0,
        precioCentavos: 5000,
      }),
    );
    const p = await app((db) =>
      crearPedido(db, {
        ...datosPedido(nellyId),
        codigos: ['CMZ1'],
        descuentoManualCentavos: 5000,
        descuentoManualMotivo: 'Regalo',
      }),
    );
    expect(
      (await app((db) => db.execute(sql`SELECT estado FROM pedido WHERE id = ${p.id}`))).rows[0],
    ).toMatchObject({
      estado: 'liquidado',
    });
    const hoy = await app((db) =>
      db.execute<{ f: string }>(
        sql`SELECT (liquidado_at AT TIME ZONE 'America/Mexico_City')::date::text AS f FROM pedido WHERE id = ${p.id}`,
      ),
    );
    const f = hoy.rows[0]!.f;
    const mes = `${f.slice(0, 7)}-01`;
    const r = await reporte(mes, '2999-01-01');
    expect(nelly(r).pedidosDetalle).toMatchObject([{ pedidoId: p.id, baseCentavos: 0, montoCentavos: 0 }]);
  });

  it('pendientesDeVendedora lista el mes cerrado mientras no se pague y lo quita al pagar', async () => {
    await liquidado(100000, '2026-11-05');
    const c = await cerrar('2026-11-01', '2026-12-01');
    expect(await app((db) => pendientesDeVendedora(db, nellyId))).toEqual([
      { mes: '2026-11-01', nombre: 'Noviembre 2026', montoCentavos: 18000 },
    ]);
    expect(await app((db) => pendientesDeVendedora(db, rosaId))).toEqual([]);
    await pagar(c.corteId, nellyId);
    expect(await app((db) => pendientesDeVendedora(db, nellyId))).toEqual([]);
  });

  it('un mes que no es el abierto ni está cerrado → no_encontrado', async () => {
    await expect(reporte('2030-01-01', '2026-12-01')).rejects.toMatchObject({
      codigo: 'no_encontrado',
      message: 'Ese mes no tiene cierre.',
    });
  });
});
