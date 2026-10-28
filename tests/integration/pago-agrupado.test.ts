import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { vPedido } from '@/db/schema';
import { rutaComprobante } from '@/domain/imagenes';
import { crearCliente } from '@/server/clientes/servicio';
import { barrerImagenesHuerfanas } from '@/server/imagenes/barrido';
import { registrarPagoAgrupado, type DatosPagoAgrupado } from '@/server/pagos/agrupado';
import { agregarComprobante } from '@/server/pagos/comprobante';
import { posiblesDuplicados } from '@/server/pagos/duplicados';
import { registrarPagoDePedido, type DatosPagoPedido } from '@/server/pagos/servicio';
import { subirComprobante } from '@/server/pagos/subida';
import { crearPedido } from '@/server/pedidos/servicio';
import { clavesDeImagenReferenciadas } from '@/server/piezas/imagen';
import { altaPieza } from '@/server/piezas/servicio';
import { saldoFavorDeVendedor } from '@/server/saldo-favor/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { crearAlmacenMemoria } from '../apoyo/almacen-memoria';
import { jpegDePrueba } from '../apoyo/imagenes';
import { reiniciarConAdmin, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let ctx: { clienteId: string; vendedorId: string };
let otraVendedoraId = '';

async function pedidoCon(
  codigo: string,
  precioCentavos: number,
  fecha?: string,
  vendedorId = ctx.vendedorId,
) {
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
      clienteId: ctx.clienteId,
      vendedorId,
      codigos: [codigo],
      fecha,
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
    }),
  );
}
const agrupado = (
  d: Partial<DatosPagoAgrupado> & Pick<DatosPagoAgrupado, 'montoCentavos' | 'aplicaciones'>,
) =>
  app((db) =>
    registrarPagoAgrupado(db, {
      key: randomUUID(),
      adminId,
      vendedorId: ctx.vendedorId,
      metodo: 'transferencia',
      ...d,
    }),
  );
const pagarPedido = (pedidoId: string, montoCentavos: number, extra: Partial<DatosPagoPedido> = {}) =>
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
const cuenta = async (tabla: 'pago' | 'aplicacion_pago' | 'saldo_favor_mov') =>
  (await app((db) => db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${tabla}`)))).rows[0]!['n'];
const saldoVendedora = () => app((db) => saldoFavorDeVendedor(db, ctx.vendedorId));

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  ctx = {
    vendedorId: await app((db) =>
      crearVendedor(db, { nombre: 'Perla', tipo: 'revendedora', comisionPct: '18.00' }),
    ),
    clienteId: await app((db) => crearCliente(db, { nombre: 'Clienta' })),
  };
  otraVendedoraId = await app((db) =>
    crearVendedor(db, { nombre: 'Rosa', tipo: 'revendedora', comisionPct: '18.00' }),
  );
});

describe('P-1: pago agrupado de una vendedora', () => {
  it('reparte entre sus pedidos: liquida los que cubre, deja abierto el parcial y no sobra nada', async () => {
    const a = await pedidoCon('AG01', 10000, '2026-01-10');
    const b = await pedidoCon('AG02', 20000, '2026-01-11');
    const r = await agrupado({
      montoCentavos: 25000,
      aplicaciones: [
        { pedidoId: a.id, montoCentavos: 10000 },
        { pedidoId: b.id, montoCentavos: 15000 },
      ],
    });
    expect(r).toMatchObject({ sobranteCentavos: 0, liquidados: [a.folio] });
    expect(await ficha(a.id)).toMatchObject({ estado: 'liquidado', saldo: '0.00' });
    expect(await ficha(b.id)).toMatchObject({ estado: 'abierto', pagado: '150.00', saldo: '50.00' });
    expect(await cuenta('pago')).toBe(1);
    expect(await cuenta('aplicacion_pago')).toBe(2);
    expect(await cuenta('saldo_favor_mov')).toBe(0);
    const [pg] = (
      await app((db) => db.execute(sql`SELECT pagador_vendedor_id::text AS v, monto::text AS m FROM pago`))
    ).rows;
    expect(pg).toMatchObject({ v: ctx.vendedorId, m: '250.00' });
  });

  it('rechaza lo que no cabe y no escribe nada', async () => {
    const a = await pedidoCon('AG03', 10000);
    const ajeno = await pedidoCon('AG04', 10000, undefined, otraVendedoraId);
    await pagarPedido(a.id, 10000);
    const b = await pedidoCon('AG05', 10000);
    const intenta = (d: Parameters<typeof agrupado>[0]) => agrupado(d);
    await expect(
      intenta({ montoCentavos: 5000, aplicaciones: [{ pedidoId: ajeno.id, montoCentavos: 5000 }] }),
    ).rejects.toMatchObject({ codigo: 'pedido_ajeno' });
    await expect(
      intenta({ montoCentavos: 5000, aplicaciones: [{ pedidoId: a.id, montoCentavos: 5000 }] }),
    ).rejects.toMatchObject({ codigo: 'pedido_liquidado' });
    await expect(
      intenta({ montoCentavos: 20000, aplicaciones: [{ pedidoId: b.id, montoCentavos: 10001 }] }),
    ).rejects.toMatchObject({ codigo: 'pago_excede', campo: 'aplicaciones' });
    await expect(
      intenta({ montoCentavos: 5000, aplicaciones: [{ pedidoId: b.id, montoCentavos: 6000 }] }),
    ).rejects.toMatchObject({ codigo: 'reparto_excede' });
    await expect(
      intenta({
        montoCentavos: 5000,
        aplicaciones: [
          { pedidoId: b.id, montoCentavos: 1000 },
          { pedidoId: b.id, montoCentavos: 1000 },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'pedido_repetido' });
    expect(await cuenta('pago')).toBe(1); // solo el de `a`
    expect(await ficha(b.id)).toMatchObject({ pagado: '0.00' });
  });

  it('la BD también impide aplicar el pago de una vendedora al pedido de otra', async () => {
    const ajeno = await pedidoCon('AG06', 10000, undefined, otraVendedoraId);
    const e = await app((db) =>
      db.transaction((tx) =>
        tx.execute(sql`WITH p AS (
          INSERT INTO pago (idempotency_key, fecha, monto, metodo, pagador_vendedor_id, admin_id)
          VALUES (gen_random_uuid(), current_date, 50, 'transferencia', ${ctx.vendedorId}, ${adminId}) RETURNING id)
          INSERT INTO aplicacion_pago (pago_id, pedido_id, monto, fecha)
          SELECT id, ${ajeno.id}, 50, current_date FROM p`),
      ),
    ).catch((x: unknown) => x);
    expect(String((e as Error).cause ?? e)).toContain('solo se aplica a sus pedidos');
  });

  it('es idempotente: la misma llave no duplica el pago', async () => {
    const a = await pedidoCon('AG07', 10000);
    const key = randomUUID();
    const d = { key, montoCentavos: 4000, aplicaciones: [{ pedidoId: a.id, montoCentavos: 4000 }] };
    const r1 = await agrupado(d);
    const r2 = await agrupado(d);
    expect(r2).toEqual(r1);
    expect(await cuenta('pago')).toBe(1);
    expect(await ficha(a.id)).toMatchObject({ pagado: '40.00' });
  });
});

describe('P-2: sobrante y saldo a favor de la vendedora', () => {
  it('lo que sobra queda como saldo suyo y se usa después como método «saldo a favor»', async () => {
    const a = await pedidoCon('SO01', 10000);
    const r = await agrupado({
      montoCentavos: 30000,
      aplicaciones: [{ pedidoId: a.id, montoCentavos: 10000 }],
    });
    expect(r.sobranteCentavos).toBe(20000);
    expect(await saldoVendedora()).toBe('200.00');
    const [mov] = (
      await app((db) =>
        db.execute(
          sql`SELECT tipo::text AS tipo, vendedor_id::text AS v, cliente_id, pago_id::text AS p FROM saldo_favor_mov`,
        ),
      )
    ).rows;
    expect(mov).toMatchObject({ tipo: 'sobrante', v: ctx.vendedorId, cliente_id: null, p: r.pagoId });

    const b = await pedidoCon('SO02', 15000);
    await pagarPedido(b.id, 5000, { metodo: 'saldo_favor', pagador: 'vendedor' });
    expect(await saldoVendedora()).toBe('150.00');
    const c = await pedidoCon('SO03', 20000);
    const g = await agrupado({
      metodo: 'saldo_favor',
      montoCentavos: 15000,
      aplicaciones: [
        { pedidoId: b.id, montoCentavos: 10000 },
        { pedidoId: c.id, montoCentavos: 5000 },
      ],
    });
    expect(g).toMatchObject({ sobranteCentavos: 0, liquidados: [b.folio] });
    expect(await saldoVendedora()).toBe('0.00');
  });

  it('con saldo a favor no alcanza más que el saldo y no deja sobrante', async () => {
    const a = await pedidoCon('SO04', 10000);
    await agrupado({ montoCentavos: 12000, aplicaciones: [{ pedidoId: a.id, montoCentavos: 10000 }] });
    const b = await pedidoCon('SO05', 10000);
    await expect(
      agrupado({
        metodo: 'saldo_favor',
        montoCentavos: 3000,
        aplicaciones: [{ pedidoId: b.id, montoCentavos: 3000 }],
      }),
    ).rejects.toMatchObject({ codigo: 'saldo_insuficiente' });
    await expect(
      agrupado({
        metodo: 'saldo_favor',
        montoCentavos: 2000,
        aplicaciones: [{ pedidoId: b.id, montoCentavos: 1000 }],
      }),
    ).rejects.toMatchObject({ codigo: 'reparto_incompleto' });
    expect(await saldoVendedora()).toBe('20.00');
  });

  it('un pago sin aplicaciones es todo sobrante', async () => {
    const r = await agrupado({ montoCentavos: 7000, aplicaciones: [] });
    expect(r.sobranteCentavos).toBe(7000);
    expect(await saldoVendedora()).toBe('70.00');
  });
});

describe('P-3: comprobante', () => {
  it('se guarda con el pago, se agrega después una sola vez y la misma captura no se repite', async () => {
    const almacen = crearAlmacenMemoria();
    const a = await pedidoCon('CO01', 10000);
    const b = await pedidoCon('CO02', 10000);
    const bytes = await jpegDePrueba();
    const c1 = await subirComprobante(almacen, bytes);
    expect(almacen.rutas()).toEqual([rutaComprobante(c1.clave)]);
    const r = await agrupado({
      montoCentavos: 10000,
      referencia: '  ABC123  ',
      comprobante: c1,
      aplicaciones: [{ pedidoId: a.id, montoCentavos: 10000 }],
    });
    const fila = async () =>
      (
        await app((db) =>
          db.execute(
            sql`SELECT referencia, comprobante_clave::text AS clave, comprobante_sha256 AS sha FROM pago WHERE id = ${r.pagoId}`,
          ),
        )
      ).rows[0]!;
    expect(await fila()).toMatchObject({ referencia: 'ABC123', clave: c1.clave, sha: c1.sha256 });

    // La misma captura en otro pago vigente: rechazada con el mensaje del servicio.
    const c2 = await subirComprobante(almacen, bytes);
    expect(c2.sha256).toBe(c1.sha256);
    await expect(pagarPedido(b.id, 5000, { comprobante: c2, referencia: 'OTRA' })).rejects.toMatchObject({
      campo: 'comprobante',
      message: 'Esa captura ya está registrada en otro pago.',
    });

    // Pago sin captura: se agrega después, una sola vez.
    const p = await pagarPedido(b.id, 5000);
    const c3 = await subirComprobante(almacen, await jpegDePrueba({ ancho: 800 }));
    const k = randomUUID();
    await app((db) => agregarComprobante(db, { key: k, adminId, pagoId: p.pagoId, ...c3 }));
    await app((db) => agregarComprobante(db, { key: k, adminId, pagoId: p.pagoId, ...c3 })); // reintento idempotente
    await expect(
      app((db) => agregarComprobante(db, { key: randomUUID(), adminId, pagoId: p.pagoId, ...c3 })),
    ).rejects.toMatchObject({ codigo: 'comprobante_existente' });
    await expect(
      app((db) => agregarComprobante(db, { key: randomUUID(), adminId, pagoId: randomUUID(), ...c3 })),
    ).rejects.toMatchObject({ codigo: 'no_encontrado' });
  });

  it('el barrido recorre comprobantes/: conserva el referenciado y borra el huérfano viejo', async () => {
    const ayer = new Date(Date.now() - 25 * 3_600_000);
    const almacen = crearAlmacenMemoria({ ahora: () => ayer });
    const a = await pedidoCon('CO03', 10000);
    const vigente = await subirComprobante(almacen, await jpegDePrueba());
    await agrupado({
      montoCentavos: 10000,
      comprobante: vigente,
      aplicaciones: [{ pedidoId: a.id, montoCentavos: 10000 }],
    });
    const huerfano = await subirComprobante(almacen, await jpegDePrueba({ ancho: 900 })); // el servicio falló después
    const r = await barrerImagenesHuerfanas({
      almacen,
      clavesReferenciadas: () => app(clavesDeImagenReferenciadas),
    });
    expect(r).toMatchObject({ referenciados: 1, borrados: 1 });
    expect(almacen.rutas()).toEqual([rutaComprobante(vigente.clave)]);
    expect(almacen.rutas()).not.toContain(rutaComprobante(huerfano.clave));
  });
});

describe('P-4: aviso de duplicado', () => {
  it('misma referencia o mismo monto y fecha del mismo pagador avisan; confirmar guarda', async () => {
    const a = await pedidoCon('DU01', 30000, '2026-01-10');
    const hoy = '2026-02-01';
    await agrupado({
      montoCentavos: 10000,
      fecha: hoy,
      referencia: 'REF-1',
      aplicaciones: [{ pedidoId: a.id, montoCentavos: 10000 }],
    });
    const nuevo = {
      montoCentavos: 10000,
      fecha: hoy,
      aplicaciones: [{ pedidoId: a.id, montoCentavos: 10000 }],
    };

    const porMonto = await agrupado(nuevo).catch((e: unknown) => e);
    expect(porMonto).toMatchObject({ codigo: 'posible_duplicado' });
    expect((porMonto as { detalle: unknown[] }).detalle).toHaveLength(1);
    expect((porMonto as Error).message).toContain(`pedido #${a.folio}`);

    await expect(
      agrupado({
        ...nuevo,
        montoCentavos: 2000,
        aplicaciones: [{ pedidoId: a.id, montoCentavos: 2000 }],
        referencia: ' ref-1 ',
      }),
    ).rejects.toMatchObject({ codigo: 'posible_duplicado' });
    expect(await cuenta('pago')).toBe(1);

    await agrupado({ ...nuevo, confirmarDuplicado: true });
    expect(await cuenta('pago')).toBe(2);

    // Otro monto y otra referencia: nada que avisar.
    await agrupado({
      ...nuevo,
      montoCentavos: 3000,
      aplicaciones: [{ pedidoId: a.id, montoCentavos: 3000 }],
    });
    expect(await cuenta('pago')).toBe(3);
  });

  it('el pago de un solo pedido avisa si se le pide verificar; sin pedirlo no cambia nada', async () => {
    const a = await pedidoCon('DU02', 30000, '2026-01-10');
    await pagarPedido(a.id, 5000, { fecha: '2026-02-01' });
    await pagarPedido(a.id, 5000, { fecha: '2026-02-01' }); // servicios internos: sin verificar
    await expect(
      pagarPedido(a.id, 5000, { fecha: '2026-02-01', confirmarDuplicado: false }),
    ).rejects.toMatchObject({ codigo: 'posible_duplicado' });
    await pagarPedido(a.id, 5000, { fecha: '2026-02-01', confirmarDuplicado: true });
    expect(await cuenta('pago')).toBe(3);
  });

  it('posiblesDuplicados no mezcla pagadores distintos por monto y fecha', async () => {
    const a = await pedidoCon('DU03', 30000, '2026-01-10');
    const p = await pagarPedido(a.id, 5000, { fecha: '2026-02-01' });
    const consulta = (pagador: { clienteId?: string; vendedorId?: string }) =>
      app((db) => posiblesDuplicados(db, { montoCentavos: 5000, fecha: '2026-02-01', pagador }));
    expect(await consulta({ clienteId: ctx.clienteId })).toEqual([
      { pagoId: p.pagoId, folio: a.folio, fecha: '2026-02-01', montoCentavos: 5000 },
    ]);
    expect(await consulta({ vendedorId: ctx.vendedorId })).toEqual([]);
  });
});
