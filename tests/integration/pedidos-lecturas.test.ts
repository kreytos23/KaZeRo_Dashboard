import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { crearCliente } from '@/server/clientes/servicio';
import { crearExhibidor, enviarPiezas, obtenerExhibidor } from '@/server/exhibidores/servicio';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import {
  apartadasDeExhibidor,
  listarPedidos,
  obtenerPedidoPorFolio,
  previsualizarPedido,
  resumenCliente,
} from '@/server/pedidos/lecturas';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza, historial, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let ctx: { clienteId: string; vendedorId: string };
const alta = (codigo: string, precioCentavos = 14900) =>
  app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Anillos',
      descripcion: `Anillo ${codigo}`,
      costoCentavos: 0,
      precioCentavos,
    }),
  );
const crear = (codigos: string[], extra: { clienteId?: string; cuentaTarjeta?: boolean } = {}) =>
  app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      ...ctx,
      codigos,
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
      ...extra,
    }),
  );

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  ctx = {
    vendedorId: await app((db) => crearVendedor(db, { nombre: 'Kazero', tipo: 'casa', comisionPct: '0.00' })),
    clienteId: await app((db) => crearCliente(db, { nombre: 'Tanya' })),
  };
});

describe('lecturas de pedidos', () => {
  it('vista previa: piezas en orden, disponibilidad con folio, faltantes y siguiente posición (R-23)', async () => {
    await alta('LE01');
    await alta('LE02');
    const p = await crear(['LE02']);
    const r = await app((db) =>
      previsualizarPedido(db, {
        clienteId: ctx.clienteId,
        codigos: ['le01', 'NOPE', 'LE02', 'LE01'],
        cuentaTarjeta: true,
      }),
    );
    expect(r.piezas.map((x) => [x.codigo, x.disponible, x.folioApartada])).toEqual([
      ['LE01', true, null],
      ['LE02', false, p.folio],
    ]);
    expect(r.faltantes).toEqual(['NOPE']);
    expect(r.cliente).toMatchObject({ id: ctx.clienteId, nombre: 'Tanya' });
    expect(r.tarjeta).toEqual({
      ciclo: 1,
      posicion: 2,
      pctBps: 0,
      sinLealtad: null,
      foliosConSaldo: [p.folio],
    });
  });

  it('vista previa R-29: en la 5 con saldo pendiente explica con folios; sin cliente no hay tarjeta', async () => {
    for (const c of ['LF1', 'LF2', 'LF3']) {
      await alta(c, 0);
      await crear([c]);
    }
    await alta('LF4');
    const cuatro = await crear(['LF4']);
    const r = await app((db) =>
      previsualizarPedido(db, { clienteId: ctx.clienteId, codigos: [], cuentaTarjeta: true }),
    );
    expect(r.tarjeta).toEqual({
      ciclo: 1,
      posicion: 5,
      pctBps: 0,
      sinLealtad: 'saldo_pendiente',
      foliosConSaldo: [cuatro.folio],
    });
    expect(
      (await app((db) => previsualizarPedido(db, { clienteId: null, codigos: [], cuentaTarjeta: true })))
        .tarjeta,
    ).toBeNull();
  });

  it('ficha por folio con líneas y pagos; listado con filtros y "con saldo"', async () => {
    await alta('LG01');
    await alta('LG02');
    const a = await crear(['LG01']);
    const b = await crear(['LG02']);
    await app((db) =>
      registrarPagoDePedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: b.id,
        montoCentavos: 14900,
        metodo: 'efectivo',
        pagador: 'cliente',
      }),
    );
    const f = (await app((db) => obtenerPedidoPorFolio(db, a.folio)))!;
    expect(f).toMatchObject({ folio: a.folio, estado: 'abierto', clienteNombre: 'Tanya', saldo: '149.00' });
    expect(f.items.map((i) => i.codigo)).toEqual(['LG01']);
    expect((await app((db) => obtenerPedidoPorFolio(db, b.folio)))!.pagos).toHaveLength(1);
    expect(await app((db) => obtenerPedidoPorFolio(db, 99999))).toBeNull();
    expect((await app((db) => listarPedidos(db, { conSaldo: true }))).map((x) => x.folio)).toEqual([a.folio]);
    expect((await app((db) => listarPedidos(db, { estado: 'liquidado' }))).map((x) => x.folio)).toEqual([
      b.folio,
    ]);
    expect((await app((db) => listarPedidos(db, { q: `kzr-${b.folio}` }))).map((x) => x.folio)).toEqual([
      b.folio,
    ]);
    expect((await app((db) => listarPedidos(db, { q: 'tanya' }))).map((x) => x.folio)).toEqual([
      b.folio,
      a.folio,
    ]);
  });

  it('resumen del cliente: tarjeta ●◐○ (R-25), saldo pendiente y saldo a favor', async () => {
    await alta('LH01', 0);
    await alta('LH02');
    await alta('LH03', 20000);
    await crear(['LH01']); // liquidado
    await crear(['LH02']); // abierto
    const c = await crear(['LH03']);
    await app((db) =>
      registrarPagoDePedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: c.id,
        montoCentavos: 5000,
        metodo: 'efectivo',
        pagador: 'cliente',
      }),
    );
    const f = await app(async (db) => (await obtenerPedidoPorFolio(db, c.folio))!);
    await app((db) =>
      cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: c.id, version: f.version, motivo: 'x' }),
    );
    const r = await app((db) => resumenCliente(db, ctx.clienteId));
    expect(r.tarjeta[0]!.casillas.slice(0, 3).map((x) => x.estado)).toEqual(['contada', 'apartada', 'libre']);
    expect(r).toMatchObject({ saldoPendiente: '149.00', saldoFavor: '50.00' });
    expect(r.pedidos).toHaveLength(3);
  });

  it('exhibidor: lista sus apartadas con folio y cliente; historial de la pieza trae el folio', async () => {
    await alta('LI01');
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: 'Tanys', fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['LI01'] }));
    const p = await crear(['LI01']);
    expect(await app((db) => apartadasDeExhibidor(db, exhibidorId))).toEqual([
      { codigo: 'LI01', descripcion: 'Anillo LI01', folio: p.folio, clienteNombre: 'Tanya' },
    ]);
    expect((await app((db) => obtenerExhibidor(db, exhibidorId)))!).toMatchObject({
      piezasActuales: 0,
      piezasApartadas: 1,
    });
    const pz = (await app((db) => obtenerPiezaPorCodigo(db, 'LI01')))!;
    expect((await app((db) => historial(db, pz.id)))[0]).toMatchObject({
      tipo: 'apartado',
      pedidoFolio: p.folio,
    });
  });

  it('listado: filtra por cliente y por rango de fechas (inclusive), valida fechas y acota la paginación', async () => {
    const otro = await app((db) => crearCliente(db, { nombre: 'Marisol' }));
    await alta('LJ01');
    await alta('LJ02');
    await alta('LJ03');
    const a = await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        ...ctx,
        codigos: ['LJ01'],
        cuentaTarjeta: true,
        descuentoManualCentavos: 0,
        fecha: '2026-09-01',
      }),
    );
    const b = await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        ...ctx,
        codigos: ['LJ02'],
        cuentaTarjeta: true,
        descuentoManualCentavos: 0,
        fecha: '2026-09-15',
      }),
    );
    const c = await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        ...ctx,
        clienteId: otro,
        codigos: ['LJ03'],
        cuentaTarjeta: true,
        descuentoManualCentavos: 0,
        fecha: '2026-09-30',
      }),
    );
    const folios = async (f: Parameters<typeof listarPedidos>[1]) =>
      (await app((db) => listarPedidos(db, f))).map((x) => x.folio);

    expect(await folios({ clienteId: otro })).toEqual([c.folio]);
    expect(await folios({ clienteId: ctx.clienteId })).toEqual([b.folio, a.folio]);
    // Los extremos cuentan (inclusive).
    expect(await folios({ desde: '2026-09-15' })).toEqual([c.folio, b.folio]);
    expect(await folios({ hasta: '2026-09-15' })).toEqual([b.folio, a.folio]);
    expect(await folios({ desde: '2026-09-02', hasta: '2026-09-29' })).toEqual([b.folio]);
    expect(await folios({ desde: '2026-09-16', hasta: '2026-09-29' })).toEqual([]);
    // Combinados con cliente.
    expect(await folios({ clienteId: ctx.clienteId, desde: '2026-09-10' })).toEqual([b.folio]);
    // Fechas imposibles se rechazan en vez de llegar a la BD.
    await expect(folios({ desde: '2026-02-30' })).rejects.toThrow('La fecha «desde» no es válida');
    await expect(folios({ hasta: 'ayer' })).rejects.toThrow('La fecha «hasta» no es válida');
    // Paginación acotada: límite mínimo 1, offset negativo se trata como 0.
    expect(await folios({ limite: 0, offset: -5 })).toEqual([c.folio]);
    expect(await folios({ limite: 1, offset: 1 })).toEqual([b.folio]);
  });
});
