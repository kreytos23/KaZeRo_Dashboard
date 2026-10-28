import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pago, vPedido } from '@/db/schema';
import { crearCliente } from '@/server/clientes/servicio';
import { consultaElegibles } from '@/server/comisiones/lecturas';
import { cerrarMesComisiones } from '@/server/comisiones/servicio';
import { registrarEntregaExhibidor, registrarVentaExhibidor } from '@/server/exhibidores/dinero';
import { historialDineroExhibidor, porEntregarCentavos } from '@/server/exhibidores/lecturas-dinero';
import { crearExhibidor, enviarPiezas } from '@/server/exhibidores/servicio';
import { registrarPagoAgrupado, type DatosPagoAgrupado } from '@/server/pagos/agrupado';
import { anularPago } from '@/server/pagos/anular';
import { registrarPagoDePedido, type DatosPagoPedido } from '@/server/pagos/servicio';
import { devolverPiezaDefectuosa } from '@/server/pedidos/devolucion';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { saldoFavorDeCliente, saldoFavorDeVendedor } from '@/server/saldo-favor/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

// Plan 4b, Task 3: deshacer un pago (P-5) y reembolso en efectivo al cancelar (P-6).
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let vendedorId = '';
let clienteId = '';
let otraClienteId = '';

async function pedidoCon(codigos: string[], o: { fecha?: string; cliente?: string } = {}) {
  for (const codigo of codigos)
    await app((db) =>
      altaPieza(db, {
        codigo,
        categoria: 'Aretes',
        descripcion: `Arete ${codigo}`,
        costoCentavos: 0,
        precioCentavos: 10000,
      }),
    );
  return app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      clienteId: o.cliente ?? clienteId,
      vendedorId,
      codigos,
      fecha: o.fecha,
      cuentaTarjeta: false,
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
      omitirAvisoDuplicado: true,
      ...extra,
    }),
  );
const agrupado = (d: Pick<DatosPagoAgrupado, 'montoCentavos' | 'aplicaciones'>) =>
  app((db) =>
    registrarPagoAgrupado(db, {
      key: randomUUID(),
      adminId,
      vendedorId,
      metodo: 'transferencia',
      confirmarDuplicado: true,
      ...d,
    }),
  );
const anular = (pagoId: string, key = randomUUID(), motivo = 'Transferencia rechazada') =>
  app((db) => anularPago(db, { key, adminId, pagoId, motivo }));
const cancelar = async (pedidoId: string, reembolso?: { nota: string }) => {
  const f = await ficha(pedidoId);
  return app((db) =>
    cancelarPedido(db, {
      key: randomUUID(),
      adminId,
      pedidoId,
      version: f.version,
      motivo: 'Ya no lo quiere',
      reembolso,
    }),
  );
};
const ficha = (id: string) =>
  app(async (db) => (await db.select().from(vPedido).where(eq(vPedido.id, id)))[0]!);
const estadoPieza = async (codigo: string) => (await app((db) => obtenerPiezaPorCodigo(db, codigo)))!.estado;
const saldoClienta = (id = clienteId) => app((db) => saldoFavorDeCliente(db, id));
const saldoVendedora = () => app((db) => saldoFavorDeVendedor(db, vendedorId));
const filas = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) =>
  (await app((db) => db.execute(q))).rows as T[];
const falla = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as { codigo?: string; message: string },
  );

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  clienteId = await app((db) => crearCliente(db, { nombre: 'Clienta' }));
  otraClienteId = await app((db) => crearCliente(db, { nombre: 'Otra clienta' }));
});

describe('P-5: deshacer un pago', () => {
  it('reabre el pedido liquidado y sus piezas, marca quién, cuándo y por qué; volver a pagar lo liquida', async () => {
    const p = await pedidoCon(['AN01']);
    const pg = await pagar(p.id, 10000);
    expect(pg.estado).toBe('liquidado');
    expect(await estadoPieza('AN01')).toBe('vendida');

    expect(await anular(pg.pagoId)).toEqual({ reabiertos: [p.folio] });
    expect(await ficha(p.id)).toMatchObject({
      estado: 'abierto',
      pagado: '0.00',
      saldo: '100.00',
      liquidadoAt: null,
    });
    expect(await estadoPieza('AN01')).toBe('apartada');
    const [mov] = await filas<{ tipo: string; de: string; a: string }>(
      sql`SELECT tipo::text, de_estado::text AS de, a_estado::text AS a FROM movimiento_pieza ORDER BY orden DESC LIMIT 1`,
    );
    expect(mov).toEqual({ tipo: 'cancelacion_venta', de: 'vendida', a: 'apartada' });
    const [anulado] = await app((db) => db.select().from(pago).where(eq(pago.id, pg.pagoId)));
    expect(anulado).toMatchObject({ anulacionMotivo: 'Transferencia rechazada', anuladoPor: adminId });
    expect(anulado!.anuladoAt).toBeInstanceOf(Date);

    expect((await pagar(p.id, 10000)).estado).toBe('liquidado');
    expect(await estadoPieza('AN01')).toBe('vendida');
  });

  it('valida el motivo y rechaza un pago inexistente o ya deshecho', async () => {
    const p = await pedidoCon(['AN02']);
    const pg = await pagar(p.id, 4000);
    expect(await falla(anular(pg.pagoId, randomUUID(), '  '))).toMatchObject({ codigo: 'motivo_invalido' });
    expect(await falla(anular(randomUUID()))).toMatchObject({ codigo: 'no_encontrado' });
    expect(await anular(pg.pagoId)).toEqual({ reabiertos: [] }); // estaba abierto: sigue abierto
    expect(await ficha(p.id)).toMatchObject({ estado: 'abierto', pagado: '0.00' });
    expect(await falla(anular(pg.pagoId))).toMatchObject({ codigo: 'pago_anulado' });
  });

  it('es idempotente: la misma llave devuelve lo mismo y no anula dos veces', async () => {
    const p = await pedidoCon(['AN03']);
    const pg = await pagar(p.id, 10000);
    const key = randomUUID();
    const [a, b] = await Promise.all([anular(pg.pagoId, key), anular(pg.pagoId, key)]);
    expect(a).toEqual(b);
    expect(a).toEqual({ reabiertos: [p.folio] });
    const movs = await filas<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM movimiento_pieza WHERE tipo::text = 'cancelacion_venta'`,
    );
    expect(movs[0]!.n).toBe(1);
  });

  it('pago agrupado con sobrante: quita el sobrante del saldo de la vendedora y reabre sus pedidos', async () => {
    const a = await pedidoCon(['AN04']);
    const b = await pedidoCon(['AN05']);
    const pg = await agrupado({
      montoCentavos: 25000,
      aplicaciones: [
        { pedidoId: a.id, montoCentavos: 10000 },
        { pedidoId: b.id, montoCentavos: 10000 },
      ],
    });
    expect(await saldoVendedora()).toBe('50.00');
    const r = await anular(pg.pagoId);
    expect([...r.reabiertos].sort()).toEqual([a.folio, b.folio].sort());
    expect(await saldoVendedora()).toBe('0.00');
    const [mov] = await filas<{ monto: string }>(
      sql`SELECT monto::text FROM saldo_favor_mov WHERE tipo::text = 'anulacion' AND pago_id = ${pg.pagoId}`,
    );
    expect(mov!.monto).toBe('-50.00');
  });

  it('si el sobrante ya se usó no se puede; deshecho lo que lo usó, sí', async () => {
    const a = await pedidoCon(['AN06']);
    const b = await pedidoCon(['AN07']);
    const pg = await agrupado({
      montoCentavos: 15000,
      aplicaciones: [{ pedidoId: a.id, montoCentavos: 10000 }],
    });
    const uso = await pagar(b.id, 5000, { metodo: 'saldo_favor', pagador: 'vendedor' });
    expect(await saldoVendedora()).toBe('0.00');
    const e = await falla(anular(pg.pagoId));
    expect(e).toMatchObject({ codigo: 'sobrante_usado' });
    expect(e!.message).toContain('ya se usó');
    expect(await ficha(a.id)).toMatchObject({ estado: 'liquidado' });

    // Deshacer el pago con saldo a favor devuelve lo usado a su titular.
    await anular(uso.pagoId);
    expect(await saldoVendedora()).toBe('50.00');
    expect(await ficha(b.id)).toMatchObject({ pagado: '0.00' });
    expect(await anular(pg.pagoId)).toEqual({ reabiertos: [a.folio] });
    expect(await saldoVendedora()).toBe('0.00');
  });

  it('un pago con saldo a favor de la clienta: el saldo vuelve y el pedido se reabre', async () => {
    const x = await pedidoCon(['AN08']);
    await pagar(x.id, 6000);
    await cancelar(x.id); // 60 a saldo a favor
    const y = await pedidoCon(['AN09', 'AN10']);
    await pagar(y.id, 14000);
    const conSaldo = await pagar(y.id, 6000, { metodo: 'saldo_favor' });
    expect(conSaldo.estado).toBe('liquidado');
    expect(await saldoClienta()).toBe('0.00');
    expect(await anular(conSaldo.pagoId)).toEqual({ reabiertos: [y.folio] });
    expect(await saldoClienta()).toBe('60.00');
    expect(await ficha(y.id)).toMatchObject({ estado: 'abierto', saldo: '60.00' });
    expect(await estadoPieza('AN09')).toBe('apartada');
    expect(await estadoPieza('AN10')).toBe('apartada');
  });

  it('no se puede si una aplicación ya se anuló por la cancelación de su pedido', async () => {
    const a = await pedidoCon(['AN11']);
    const b = await pedidoCon(['AN12']);
    const pg = await agrupado({
      montoCentavos: 10000,
      aplicaciones: [
        { pedidoId: a.id, montoCentavos: 4000 },
        { pedidoId: b.id, montoCentavos: 6000 },
      ],
    });
    await cancelar(a.id);
    expect(await falla(anular(pg.pagoId))).toMatchObject({ codigo: 'pago_anulacion_aplicacion_previa' });
    expect(await ficha(b.id)).toMatchObject({ pagado: '60.00' });
  });

  describe('cobrado por un exhibidor', () => {
    let exhibidorId = '';
    beforeEach(async () => {
      exhibidorId = await app((db) =>
        crearExhibidor(db, { vendedorId, nombre: 'Estética Luz', fechaEnvio: '2026-10-01' }),
      );
      await app((db) =>
        altaPieza(db, {
          codigo: 'EXA1',
          categoria: 'Aretes',
          descripcion: 'Arete EXA1',
          costoCentavos: 0,
          precioCentavos: 10000,
        }),
      );
      await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['EXA1'] }));
    });
    const venta = () =>
      app((db) =>
        registrarVentaExhibidor(db, {
          key: randomUUID(),
          adminId,
          exhibidorId,
          codigos: ['EXA1'],
          clienteId: null,
          cobradoCentavos: 10000,
          metodo: 'efectivo',
        }),
      );
    const pagoDe = async (pedidoId: string) =>
      (
        await filas<{ id: string }>(
          sql`SELECT pago_id::text AS id FROM aplicacion_pago WHERE pedido_id = ${pedidoId}`,
        )
      )[0]!.id;

    it('baja su por entregar y sale de sus cobros; la pieza queda apartada', async () => {
      const v = await venta();
      expect(await app((db) => porEntregarCentavos(db, exhibidorId))).toBe(10000);
      expect(await anular(await pagoDe(v.pedidoId))).toEqual({ reabiertos: [v.folio] });
      expect(await app((db) => porEntregarCentavos(db, exhibidorId))).toBe(0);
      const historial = await app((db) => historialDineroExhibidor(db, exhibidorId));
      expect(historial.filter((m) => m.tipo === 'cobro')).toHaveLength(0);
      expect(await estadoPieza('EXA1')).toBe('apartada');
    });

    it('si ya lo entregó y quedaría negativo, no se puede', async () => {
      const v = await venta();
      await app((db) =>
        registrarEntregaExhibidor(db, {
          key: randomUUID(),
          adminId,
          exhibidorId,
          montoCentavos: 10000,
          metodo: 'efectivo',
        }),
      );
      expect(await falla(anular(await pagoDe(v.pedidoId)))).toMatchObject({
        codigo: 'pago_anulacion_exhibidor_negativo',
      });
      expect(await ficha(v.pedidoId)).toMatchObject({ estado: 'liquidado' });
    });

    it('concurrencia: deshacer el cobro y entregarlo a la vez; solo uno gana y el por entregar no queda negativo', async () => {
      const v = await venta();
      const pagoId = await pagoDe(v.pedidoId);
      const r = await Promise.allSettled([
        anular(pagoId),
        app((db) =>
          registrarEntregaExhibidor(db, {
            key: randomUUID(),
            adminId,
            exhibidorId,
            montoCentavos: 10000,
            metodo: 'efectivo',
          }),
        ),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const error = (r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason as {
        codigo: string;
      };
      const anulado = r[0]!.status === 'fulfilled';
      if (anulado) expect(['excede', 'entrega_exhibidor_excede']).toContain(error.codigo);
      else expect(error.codigo).toBe('pago_anulacion_exhibidor_negativo');
      expect(await app((db) => porEntregarCentavos(db, exhibidorId))).toBe(0);
      expect(await ficha(v.pedidoId)).toMatchObject({ estado: anulado ? 'abierto' : 'liquidado' });
    });
  });

  it('comisión de un mes cerrado: la línea no cambia y al volver a liquidarse no se comisiona otra vez', async () => {
    const p = await pedidoCon(['AN13'], { fecha: '2026-01-10' });
    const pg = await pagar(p.id, 10000, { fecha: '2026-01-10' });
    const enero = await app((db) =>
      cerrarMesComisiones(db, { key: randomUUID(), adminId, mes: '2026-01-01', hoy: '2026-10-28' }),
    );
    expect(enero.numPedidos).toBe(1);
    const linea = async () =>
      filas(
        sql`SELECT base::text, monto::text, corte_id::text FROM comision_linea WHERE pedido_id = ${p.id}`,
      );
    const antes = await linea();
    await anular(pg.pagoId);
    expect(await ficha(p.id)).toMatchObject({ estado: 'abierto' });
    expect(await linea()).toEqual(antes);

    await pagar(p.id, 10000, { fecha: '2026-02-05' });
    expect(await ficha(p.id)).toMatchObject({ estado: 'liquidado' });
    expect(await app((db) => consultaElegibles(db, '2026-02-28', { bloquear: false }))).toEqual([]);
    const febrero = await app((db) =>
      cerrarMesComisiones(db, { key: randomUUID(), adminId, mes: '2026-02-01', hoy: '2026-10-28' }),
    );
    expect(febrero.numPedidos).toBe(0);
    expect(await linea()).toEqual(antes);
  });

  it('devolución por defecto: la línea devuelta no vuelve al pedido ni se vuelve a vender', async () => {
    const p = await pedidoCon(['AN14', 'AN15']);
    const pg = await pagar(p.id, 20000);
    const [linea] = await filas<{ id: string }>(
      sql`SELECT i.id::text FROM pedido_item i JOIN pieza z ON z.id = i.pieza_id
          WHERE i.pedido_id = ${p.id} AND z.codigo = 'AN14'`,
    );
    await app((db) =>
      devolverPiezaDefectuosa(db, {
        key: randomUUID(),
        adminId,
        pedidoId: p.id,
        itemId: linea!.id,
        motivo: 'Se rompió el broche',
      }),
    );
    expect(await saldoClienta()).toBe('100.00');

    expect(await anular(pg.pagoId)).toEqual({ reabiertos: [p.folio] });
    // Lo devuelto sigue en saldo a favor; la pieza devuelta sigue en defecto y su línea no vigente.
    expect(await saldoClienta()).toBe('100.00');
    expect(await estadoPieza('AN14')).toBe('defecto');
    expect(await estadoPieza('AN15')).toBe('apartada');
    expect(await ficha(p.id)).toMatchObject({ estado: 'abierto', pagado: '0.00', devuelto: '100.00' });

    // Al liquidarse otra vez solo se vende la pieza vigente.
    await pagar(p.id, 10000, { metodo: 'saldo_favor' });
    await pagar(p.id, 10000);
    expect(await ficha(p.id)).toMatchObject({ estado: 'liquidado' });
    expect(await estadoPieza('AN14')).toBe('defecto');
    expect(await estadoPieza('AN15')).toBe('vendida');
  });

  it('un pedido reabierto con devoluciones no se cancela y el saldo a favor no se mueve', async () => {
    const p = await pedidoCon(['AN19', 'AN20']);
    const pg = await pagar(p.id, 20000);
    const [linea] = await filas<{ id: string }>(
      sql`SELECT i.id::text FROM pedido_item i JOIN pieza z ON z.id = i.pieza_id
          WHERE i.pedido_id = ${p.id} AND z.codigo = 'AN19'`,
    );
    await app((db) =>
      devolverPiezaDefectuosa(db, {
        key: randomUUID(),
        adminId,
        pedidoId: p.id,
        itemId: linea!.id,
        motivo: 'Se rompió el broche',
      }),
    );
    await anular(pg.pagoId);
    expect(await saldoClienta()).toBe('100.00');

    const e = await falla(cancelar(p.id, { nota: 'Se le devolvió en efectivo' }));
    expect(e).toMatchObject({
      codigo: 'pedido_cancelado_con_devoluciones',
      message:
        'Este pedido tiene piezas devueltas: no se puede cancelar. Registra el pago de lo que se queda.',
    });
    expect(await falla(cancelar(p.id))).toMatchObject({ codigo: 'pedido_cancelado_con_devoluciones' });
    expect(await saldoClienta()).toBe('100.00');
    expect(await ficha(p.id)).toMatchObject({ estado: 'abierto' });
    expect(await estadoPieza('AN20')).toBe('apartada');

    // La BD es la última barrera.
    const bd = await app((db) =>
      db.transaction((tx) =>
        tx.execute(
          sql`UPDATE pedido SET estado = 'cancelado', cancelado_at = now(), cancelacion_motivo = 'x' WHERE id = ${p.id}`,
        ),
      ),
    ).catch((x: unknown) => x);
    expect(String((bd as Error).cause ?? bd)).toContain('Un pedido con devoluciones no se cancela');
  });

  it('concurrencia: deshacer un abono y cancelar su pedido a la vez; el abono cuenta una sola vez', async () => {
    const p = await pedidoCon(['AN21']);
    const pg = await pagar(p.id, 4000);
    const r = await Promise.allSettled([anular(pg.pagoId), cancelar(p.id)]);
    // Cancelar gana siempre: si va primero, el abono pasa a saldo a favor y deshacerlo se rechaza; si va
    // después, ya no hay abono vigente y cancela sin saldo a favor.
    expect(r[1]!.status).toBe('fulfilled');
    const anulado = r[0]!.status === 'fulfilled';
    if (!anulado)
      expect((r[0] as PromiseRejectedResult).reason).toMatchObject({
        codigo: 'pago_anulacion_aplicacion_previa',
      });
    expect((r[1] as PromiseFulfilledResult<{ saldoFavor: string }>).value.saldoFavor).toBe(
      anulado ? '0.00' : '40.00',
    );
    expect(await saldoClienta()).toBe(anulado ? '0.00' : '40.00');
    expect(await ficha(p.id)).toMatchObject({ estado: 'cancelado', pagado: '0.00' });
    expect(await estadoPieza('AN21')).toBe('disponible');
  });

  it('la BD no deja pasar una pieza vendida a apartada fuera de una anulación', async () => {
    const p = await pedidoCon(['AN16']);
    await pagar(p.id, 10000);
    const e = await app((db) =>
      db.transaction((tx) => tx.execute(sql`UPDATE pieza SET estado = 'apartada' WHERE codigo = 'AN16'`)),
    ).catch((x: unknown) => x);
    expect(String((e as Error).cause ?? e)).toContain('Transición de pieza no permitida');
  });

  it('concurrencia: deshacer el pago y usar su sobrante a la vez; solo uno gana y el saldo nunca queda negativo', async () => {
    const a = await pedidoCon(['AN17']);
    const b = await pedidoCon(['AN18'], { cliente: otraClienteId });
    const pg = await agrupado({
      montoCentavos: 15000,
      aplicaciones: [{ pedidoId: a.id, montoCentavos: 10000 }],
    });
    const r = await Promise.allSettled([
      anular(pg.pagoId),
      pagar(b.id, 5000, { metodo: 'saldo_favor', pagador: 'vendedor' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const error = (r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason as {
      codigo: string;
    };
    const anulado = r[0]!.status === 'fulfilled';
    // Si pierde la anulación, el rechazo del libro se traduce a sobrante_usado; si pierde el uso, es suyo.
    if (anulado) expect(['saldo_insuficiente', 'saldo_favor_insuficiente']).toContain(error.codigo);
    else expect(error.codigo).toBe('sobrante_usado');
    expect(await saldoVendedora()).toBe('0.00');
    expect(await ficha(a.id)).toMatchObject({ estado: anulado ? 'abierto' : 'liquidado' });
    expect(await ficha(b.id)).toMatchObject({ pagado: anulado ? '0.00' : '50.00' });
  });
});

describe('P-6: cancelar con reembolso en efectivo', () => {
  it('cancela y retira en la misma transacción lo abonado por la clienta y por la vendedora', async () => {
    const p = await pedidoCon(['RE01']);
    await pagar(p.id, 3000);
    await pagar(p.id, 2000, { pagador: 'vendedor' });
    const r = await cancelar(p.id, { nota: 'Se le devolvió en efectivo' });
    expect(r).toMatchObject({ saldoFavor: '0.00', reembolsado: '50.00', liberadas: 1 });
    expect(await ficha(p.id)).toMatchObject({ estado: 'cancelado' });
    expect(await saldoClienta()).toBe('0.00');
    expect(await saldoVendedora()).toBe('0.00');
    const retiros = await filas<{ monto: string; nota: string; v: boolean; pedido: string }>(
      sql`SELECT monto::text, nota, vendedor_id IS NOT NULL AS v, pedido_id::text AS pedido
          FROM saldo_favor_mov WHERE tipo::text = 'retiro' ORDER BY v`,
    );
    expect(retiros).toEqual([
      { monto: '-30.00', nota: 'Se le devolvió en efectivo', v: false, pedido: p.id },
      { monto: '-20.00', nota: 'Se le devolvió en efectivo', v: true, pedido: p.id },
    ]);
  });

  it('sin reembolso todo queda como saldo a favor; la nota del reembolso es obligatoria', async () => {
    const p = await pedidoCon(['RE02']);
    await pagar(p.id, 3000);
    expect(await falla(cancelar(p.id, { nota: ' ' }))).toMatchObject({ codigo: 'nota_invalida' });
    expect(await ficha(p.id)).toMatchObject({ estado: 'abierto' });
    expect(await cancelar(p.id)).toMatchObject({ saldoFavor: '30.00', reembolsado: '0.00' });
    expect(await saldoClienta()).toBe('30.00');
  });
});
