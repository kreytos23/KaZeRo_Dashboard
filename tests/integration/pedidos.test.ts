import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pedido, pieza, vPedido, vPedidoItem } from '@/db/schema';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { crearCliente } from '@/server/clientes/servicio';
import { crearExhibidor, enviarPiezas, regresarPiezas } from '@/server/exhibidores/servicio';
import { crearPedido, type DatosPedido } from '@/server/pedidos/servicio';
import { altaPieza, historial, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { actualizarVendedor, crearVendedor } from '@/server/vendedores/servicio';
import { adminDePrueba, truncarTodo, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let ctx: { clienteId: string; vendedorId: string };

async function piezas(prefijo: string, n: number, precioCentavos = 14900) {
  const codigos = Array.from({ length: n }, (_, i) => `${prefijo}${String(i + 1).padStart(2, '0')}`);
  for (const codigo of codigos)
    await app((db) =>
      altaPieza(db, {
        codigo,
        categoria: 'Anillos',
        descripcion: `Anillo ${codigo}`,
        costoCentavos: 0,
        precioCentavos,
      }),
    );
  return codigos;
}
function crear(d: Partial<DatosPedido> & { codigos: string[] }) {
  return app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      clienteId: ctx.clienteId,
      vendedorId: ctx.vendedorId,
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
      ...d,
    }),
  );
}
/** n compras liquidadas al instante: piezas de precio 0 → total 0 → liquidado al crearse (D-8). */
async function comprasLiquidadas(n: number, prefijo = 'LQ') {
  const codigos = await piezas(prefijo, n, 0);
  for (const c of codigos) expect((await crear({ codigos: [c] })).estado).toBe('liquidado');
}
const fichaPedido = (id: string) =>
  app(async (db) => (await db.select().from(vPedido).where(eq(vPedido.id, id)))[0]!);

beforeAll(async () => {
  await truncarTodo();
});
beforeEach(async () => {
  await truncarTodo();
  adminId = await adminDePrueba();
  const vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Kazero', tipo: 'casa', comisionPct: '0.00' }),
  );
  const clienteId = await app((db) => crearCliente(db, { nombre: 'Gloria Roldán' }));
  ctx = { clienteId, vendedorId };
});

describe('crearPedido', () => {
  it('R-10/R-11/R-12: crea la nota con folio, aparta las piezas, copia precios y deja historial', async () => {
    const [a, b] = await piezas('PA', 2);
    const r = await crear({ codigos: [b!.toLowerCase(), ` ${a} `], notas: 'Entrega el viernes' });
    expect(r).toMatchObject({
      estado: 'abierto',
      total: '298.00',
      posicion: { ciclo: 1, posicion: 1 },
      pctBps: 0,
      sinLealtad: null,
      foliosConSaldo: [],
    });
    expect(r.folio).toBeGreaterThan(0);
    expect(await fichaPedido(r.id)).toMatchObject({
      subtotal: '298.00',
      total: '298.00',
      pagado: '0.00',
      saldo: '298.00',
      piezas: 2,
    });
    const p = (await app((db) => obtenerPiezaPorCodigo(db, a!)))!;
    expect(p.estado).toBe('apartada');
    expect((await app((db) => historial(db, p.id)))[0]).toMatchObject({
      tipo: 'apartado',
      deEstado: 'disponible',
      aEstado: 'apartada',
    });
  });

  it('R-11: cambiar después el precio de la pieza no cambia el pedido', async () => {
    const [a] = await piezas('PB', 1);
    const r = await crear({ codigos: [a!] });
    // Como dueño y saltándose editarPieza (que lo prohíbe en apartada): pieza_auditoria exige contexto y motivo.
    await conDbUrl(urlOwner(), (db) =>
      db.transaction(async (tx) => {
        await fijarContextoAuditoria(tx, { adminId, motivo: 'prueba R-11' });
        await tx.update(pieza).set({ precio: '999.00' }).where(eq(pieza.codigo, a!));
      }),
    );
    const [item] = await app((db) => db.select().from(vPedidoItem).where(eq(vPedidoItem.pedidoId, r.id)));
    expect(item).toMatchObject({ precioLista: '149.00', precioFinal: '149.00' });
  });

  it('R-04/R-05 todo o nada: lista inexistentes y no disponibles (con su folio) y no aparta ninguna', async () => {
    const [a, b, c] = await piezas('PC', 3);
    const primero = await crear({ codigos: [a!] });
    await expect(crear({ codigos: [c!, a!, 'NOEXISTE', b!] })).rejects.toThrow(
      `No se creó el pedido. No existen: NOEXISTE. No están disponibles: ${a} (apartada en KZR-${primero.folio}).`,
    );
    expect((await app((db) => obtenerPiezaPorCodigo(db, c!)))!.estado).toBe('disponible');
    const n = await app((db) => db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_pedido`));
    expect(n.rows[0]!.n).toBe(1);
  });

  it('R-05 concurrencia: dos pedidos simultáneos con la misma pieza → uno solo gana, el otro con mensaje legible', async () => {
    const [a] = await piezas('PD', 1);
    const r = await Promise.allSettled([crear({ codigos: [a!] }), crear({ codigos: [a!] })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const fallo = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(fallo.reason).toMatchObject({ name: 'ErrorNegocio', campo: 'codigos' });
    expect((fallo.reason as Error).message).toMatch(/No están disponibles: PD01 \(apartada en KZR-\d+\)/);
  });

  it('R-05 concurrencia entre clientes distintos (sin el bloqueo del cliente): decide el bloqueo de la pieza', async () => {
    const otro = await app((db) => crearCliente(db, { nombre: 'Nelly Pérez' }));
    for (let ronda = 0; ronda < 3; ronda++) {
      const [a, b] = await piezas(`C${ronda}X`, 2);
      const r = await Promise.allSettled([
        crear({ codigos: [a!, b!] }),
        crear({ clienteId: otro, codigos: [b!, a!] }),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const fallo = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect(fallo.reason).toMatchObject({ name: 'ErrorNegocio', campo: 'codigos' });
      expect((fallo.reason as Error).message).toMatch(/^No se creó el pedido\. No están disponibles: /);
    }
  });

  it('R-23 concurrencia: con 4 compras liquidadas, dos pedidos simultáneos son la #5 (10 %) y la #6', async () => {
    await comprasLiquidadas(4);
    const [a, b] = await piezas('PE', 2);
    const r = await Promise.all([crear({ codigos: [a!] }), crear({ codigos: [b!] })]);
    const porPosicion = r.sort((x, y) => x.posicion!.posicion - y.posicion!.posicion);
    expect(porPosicion.map((x) => x.posicion)).toEqual([
      { ciclo: 1, posicion: 5 },
      { ciclo: 1, posicion: 6 },
    ]);
    // La #5 se decidió primero (bloqueo del cliente): sin otra nota con saldo, 10 %.
    expect(porPosicion[0]).toMatchObject({ pctBps: 1000, total: '134.10', sinLealtad: null });
    expect(porPosicion[1]).toMatchObject({ pctBps: 0, total: '149.00', sinLealtad: null });
  });

  it('R-29: la #5 con otra nota con saldo pendiente no recibe descuento, explica el motivo y ocupa la posición', async () => {
    await comprasLiquidadas(3);
    const [a, b, c] = await piezas('PF', 3);
    const cuatro = await crear({ codigos: [a!] }); // #4, abierta con saldo
    const cinco = await crear({ codigos: [b!] });
    expect(cinco).toMatchObject({
      posicion: { ciclo: 1, posicion: 5 },
      pctBps: 0,
      sinLealtad: 'saldo_pendiente',
      total: '149.00',
      foliosConSaldo: [cuatro.folio],
    });
    expect(await fichaPedido(cinco.id)).toMatchObject({
      descuentoLealtadPct: '0.00',
      sinLealtadMotivo: 'saldo_pendiente',
    });
    expect((await crear({ codigos: [c!] })).posicion).toEqual({ ciclo: 1, posicion: 6 });
  });

  it('R-29: también cuenta una nota con saldo que no cuenta para la tarjeta (R-28)', async () => {
    await comprasLiquidadas(4);
    const [a, b] = await piezas('PG', 2);
    expect((await crear({ codigos: [a!], cuentaTarjeta: false })).posicion).toBeNull();
    expect(await crear({ codigos: [b!] })).toMatchObject({
      posicion: { ciclo: 1, posicion: 5 },
      sinLealtad: 'saldo_pendiente',
    });
  });

  it('R-22: la #10 recibe 20 % si no hay otra nota con saldo', async () => {
    await comprasLiquidadas(9);
    const [a] = await piezas('PH', 1, 10000);
    expect(await crear({ codigos: [a!] })).toMatchObject({
      posicion: { ciclo: 1, posicion: 10 },
      pctBps: 2000,
      total: '80.00',
    });
  });

  it('R-26: con las 10 posiciones apartadas la siguiente inicia el ciclo 2 en la 1', async () => {
    await comprasLiquidadas(10);
    const [a] = await piezas('PI', 1);
    expect((await crear({ codigos: [a!] })).posicion).toEqual({ ciclo: 2, posicion: 1 });
  });

  it('R-24 (P4): un hueco por cancelación en un ciclo ya rebasado se llena primero', async () => {
    await comprasLiquidadas(6);
    const [a, b, c] = await piezas('PS', 3);
    const siete = await crear({ codigos: [a!] }); // #7, abierta
    expect(siete.posicion).toEqual({ ciclo: 1, posicion: 7 });
    await comprasLiquidadas(3, 'LR'); // #8 a #10
    expect((await crear({ codigos: [b!] })).posicion).toEqual({ ciclo: 2, posicion: 1 });
    // Cancelación forzada como dueño (cancelarPedido llega en la Task 6).
    await conDbUrl(urlOwner(), (db) =>
      db.transaction(async (tx) => {
        await fijarContextoAuditoria(tx, { adminId, motivo: 'prueba R-24' });
        await tx
          .update(pedido)
          .set({ estado: 'cancelado', canceladoAt: new Date(), cancelacionMotivo: 'prueba' })
          .where(eq(pedido.id, siete.id));
      }),
    );
    expect((await crear({ codigos: [c!] })).posicion).toEqual({ ciclo: 1, posicion: 7 });
  });

  it('R-28: un pedido que no cuenta no aparta posición ni recibe descuento aunque "sería" la 5', async () => {
    await comprasLiquidadas(4);
    const [a, b] = await piezas('PJ', 2);
    expect(await crear({ codigos: [a!], cuentaTarjeta: false })).toMatchObject({
      posicion: null,
      pctBps: 0,
      total: '149.00',
    });
    expect((await crear({ codigos: [b!] })).posicion).toEqual({ ciclo: 1, posicion: 5 });
  });

  it('R-12/R-13 + D-7: descuento manual acumulable, con motivo, sin exceder lo que queda', async () => {
    await comprasLiquidadas(4);
    const [a] = await piezas('PK', 1);
    await expect(crear({ codigos: [a!], descuentoManualCentavos: 1000 })).rejects.toThrow(
      'Escribe el motivo del descuento.',
    );
    await expect(
      crear({ codigos: [a!], descuentoManualCentavos: 13411, descuentoManualMotivo: 'Buen Fin' }),
    ).rejects.toThrow('El descuento manual supera el total después de lealtad ($134.10).');
    const r = await crear({
      codigos: [a!],
      descuentoManualCentavos: 1000,
      descuentoManualMotivo: 'Buen Fin',
    });
    expect(r).toMatchObject({ pctBps: 1000, total: '124.10' });
    expect(await fichaPedido(r.id)).toMatchObject({
      descuentoLealtadMonto: '14.90',
      descuentoManualMonto: '10.00',
      descuentoManualMotivo: 'Buen Fin',
    });
  });

  it('D-8: un pedido con total 0 se liquida al crearse; la pieza de exhibidor queda vendida sin exhibidor', async () => {
    const [a] = await piezas('PL', 1, 0);
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: 'X', fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: [a!] }));
    const r = await crear({ codigos: [a!] });
    expect(r.estado).toBe('liquidado');
    const p = (await app((db) => obtenerPiezaPorCodigo(db, a!)))!;
    expect(p).toMatchObject({ estado: 'vendida', exhibidorId: null });
    expect((await app((db) => historial(db, p.id))).map((m) => m.tipo).slice(0, 2)).toEqual([
      'venta',
      'apartado',
    ]);
  });

  it('D-8: con descuento manual que deja el total en 0 también se liquida', async () => {
    const [a] = await piezas('PT', 1);
    const r = await crear({ codigos: [a!], descuentoManualCentavos: 14900, descuentoManualMotivo: 'Regalo' });
    expect(r).toMatchObject({ estado: 'liquidado', total: '0.00' });
    expect((await app((db) => obtenerPiezaPorCodigo(db, a!)))!.estado).toBe('vendida');
  });

  it('una pieza en exhibidor queda apartada conservando su exhibidor', async () => {
    const [a] = await piezas('PM', 1);
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: 'Nelly', fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: [a!] }));
    await crear({ codigos: [a!] });
    expect((await app((db) => obtenerPiezaPorCodigo(db, a!)))!).toMatchObject({
      estado: 'apartada',
      exhibidorId,
    });
  });

  it('R-37: la misma key dos veces (simultáneas) crea un solo pedido y devuelve lo mismo', async () => {
    const [a] = await piezas('PN', 1);
    const key = randomUUID();
    const [x, y] = await Promise.all([crear({ key, codigos: [a!] }), crear({ key, codigos: [a!] })]);
    expect(x).toEqual(y);
    const n = await app((db) => db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_pedido`));
    expect(n.rows[0]!.n).toBe(1);
  });

  it('valida vendedor activo, cliente, fecha, notas y lista de códigos antes de escribir', async () => {
    const [a] = await piezas('PO', 1);
    await expect(crear({ codigos: [] })).rejects.toThrow('Agrega al menos una pieza.');
    await expect(crear({ codigos: [a!, a!.toLowerCase()] })).rejects.toThrow(`Códigos repetidos: ${a}.`);
    await expect(crear({ codigos: [a!], fecha: '2026-02-30' })).rejects.toThrow('La fecha no es válida.');
    await expect(crear({ codigos: [a!], fecha: '2999-01-01' })).rejects.toThrow(
      'La fecha no puede ser futura.',
    );
    await expect(crear({ codigos: [a!], notas: 'x'.repeat(501) })).rejects.toThrow(
      'Las notas admiten hasta 500 caracteres.',
    );
    await expect(crear({ codigos: [a!], clienteId: randomUUID() })).rejects.toThrow('El cliente no existe.');
    const v = await app((db) =>
      db.execute<{ version: number }>(sql`SELECT version FROM vendedor WHERE id = ${ctx.vendedorId}`),
    );
    await app((db) =>
      actualizarVendedor(db, {
        id: ctx.vendedorId,
        version: v.rows[0]!.version,
        nombre: 'Kazero',
        tipo: 'casa',
        comisionPct: '0.00',
        activo: false,
        adminId,
      }),
    );
    await expect(crear({ codigos: [a!] })).rejects.toThrow('El vendedor está inactivo.');
    expect((await app((db) => obtenerPiezaPorCodigo(db, a!)))!.estado).toBe('disponible');
  });

  it('crearPedido y regresarPiezas simultáneos sobre la misma pieza no se interbloquean', async () => {
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: 'Y', fechaEnvio: '2026-10-01' }),
    );
    for (let ronda = 0; ronda < 5; ronda++) {
      const [a] = await piezas(`R${ronda}X`, 1);
      await app((db) => enviarPiezas(db, { exhibidorId, codigos: [a!] }));
      const r = await Promise.allSettled([
        crear({ codigos: [a!] }),
        app((db) => regresarPiezas(db, { exhibidorId, codigos: [a!] })),
      ]);
      for (const x of r)
        if (x.status === 'rejected') {
          expect((x.reason as Error).name).toBe('ErrorNegocio');
          expect((x.reason as { codigo: string }).codigo).not.toBe('conflicto_concurrente');
        }
    }
  });

  it('D-21: guarda quién creó el pedido y el admin en cada movimiento de pieza', async () => {
    const [a] = await piezas('PP', 1);
    const r = await crear({ codigos: [a!] });
    const f = await conDbUrl(urlOwner(), (db) =>
      db.execute(sql`SELECT p.admin_id AS creador, m.admin_id AS movio FROM pedido p
        JOIN movimiento_pieza m ON m.pedido_id = p.id WHERE p.id = ${r.id}`),
    );
    expect(f.rows).toEqual([{ creador: adminId, movio: adminId }]);
  });

  it('D-8 + Plan 2.1: liquidar al crearse deja el cambio de estado en la bitácora', async () => {
    const [a] = await piezas('PQ', 1, 0);
    const r = await crear({ codigos: [a!] });
    const f = await app((db) =>
      db.execute(
        sql`SELECT campo, antes, despues FROM v_auditoria WHERE entidad = 'pedido' AND entidad_id = ${r.id}`,
      ),
    );
    expect(f.rows).toEqual([{ campo: 'estado', antes: 'abierto', despues: 'liquidado' }]);
  });
});
