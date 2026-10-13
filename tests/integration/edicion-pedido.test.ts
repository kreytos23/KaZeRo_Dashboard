import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { vPedido, vPedidoItem } from '@/db/schema';
import { crearCliente } from '@/server/clientes/servicio';
import { crearExhibidor, enviarPiezas } from '@/server/exhibidores/servicio';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { cancelarPedido, crearPedido, editarPedido, type DatosEdicion } from '@/server/pedidos/servicio';
import { altaPieza, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let ctx: { clienteId: string; vendedorId: string };

async function alta(codigo: string, precioCentavos = 10000) {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Pulseras',
      descripcion: `Pulsera ${codigo}`,
      costoCentavos: 0,
      precioCentavos,
    }),
  );
  return codigo;
}
const crear = (codigos: string[]) =>
  app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      ...ctx,
      codigos,
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
    }),
  );
const ficha = (id: string) =>
  app(async (db) => (await db.select().from(vPedido).where(eq(vPedido.id, id)))[0]!);
async function editar(id: string, cambios: Partial<DatosEdicion>) {
  const f = await ficha(id);
  return app((db) =>
    editarPedido(db, {
      key: randomUUID(),
      adminId,
      pedidoId: id,
      version: f.version,
      vendedorId: f.vendedorId,
      fecha: f.fecha,
      descuentoManualCentavos: 0,
      notas: f.notas,
      agregar: [],
      quitar: [],
      ...cambios,
    }),
  );
}

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  ctx = {
    vendedorId: await app((db) => crearVendedor(db, { nombre: 'Kazero', tipo: 'casa', comisionPct: '0.00' })),
    clienteId: await app((db) => crearCliente(db, { nombre: 'Michelle' })),
  };
});

describe('editarPedido', () => {
  it('R-22/R-27: agregar una pieza a la #5 le aplica el 10 % guardado y no mueve la posición', async () => {
    for (const c of ['E1', 'E2', 'E3', 'E4']) await crear([await alta(c, 0)]);
    const p = await crear([await alta('ED01')]);
    expect(p).toMatchObject({ posicion: { ciclo: 1, posicion: 5 }, total: '90.00' });
    expect(
      await editar(p.id, { agregar: [await alta('ED02', 5000)], motivo: 'Agregó una pulsera' }),
    ).toMatchObject({
      estado: 'abierto',
      total: '135.00',
      cambios: true,
    });
    expect(await ficha(p.id)).toMatchObject({
      posicionTarjeta: 5,
      descuentoLealtadPct: '10.00',
      subtotal: '150.00',
      piezas: 2,
    });
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'ED02')))!.estado).toBe('apartada');
  });

  it('quitar una pieza la regresa a su exhibidor, la marca quitada y baja el total', async () => {
    const a = await alta('ED03');
    const b = await alta('ED04');
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: 'K', fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: [b] }));
    const p = await crear([a, b]);
    expect(await editar(p.id, { quitar: [b.toLowerCase()], motivo: 'No le quedó' })).toMatchObject({
      total: '100.00',
    });
    expect((await app((db) => obtenerPiezaPorCodigo(db, b)))!).toMatchObject({
      estado: 'en_exhibidor',
      exhibidorId,
    });
    const items = await app((db) => db.select().from(vPedidoItem).where(eq(vPedidoItem.pedidoId, p.id)));
    expect(items.find((i) => i.codigo === b)).toMatchObject({ vigente: false });
    expect(items.find((i) => i.codigo === b)!.quitadoAt).not.toBeNull();
  });

  it('no deja quitar la última pieza ni quitar lo que no está en el pedido', async () => {
    const p = await crear([await alta('ED05')]);
    await expect(editar(p.id, { quitar: ['ED05'], motivo: 'x' })).rejects.toThrow(
      'Un pedido necesita al menos una pieza. Para quitarlas todas, cancélalo.',
    );
    await expect(editar(p.id, { quitar: ['ZZ99'], motivo: 'x' })).rejects.toThrow(
      'No están en este pedido: ZZ99.',
    );
  });

  it('el total no puede quedar por debajo de lo pagado; si queda igual, se liquida (R-15)', async () => {
    const p = await crear([await alta('ED06'), await alta('ED07', 2000)]);
    await app((db) =>
      registrarPagoDePedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: p.id,
        montoCentavos: 10000,
        metodo: 'efectivo',
        pagador: 'cliente',
      }),
    );
    await expect(
      editar(p.id, { descuentoManualCentavos: 3000, descuentoManualMotivo: 'Promo', motivo: 'Promo' }),
    ).rejects.toThrow('El nuevo total ($90.00) quedaría por debajo de lo ya pagado ($100.00).');
    expect(await editar(p.id, { quitar: ['ED07'], motivo: 'Solo una' })).toMatchObject({
      estado: 'liquidado',
      total: '100.00',
    });
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'ED06')))!.estado).toBe('vendida');
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'ED07')))!.estado).toBe('disponible');
  });

  it('motivo obligatorio solo si cambia el dinero; cambiar notas no lo pide; sin cambios no escribe', async () => {
    const p = await crear([await alta('ED08')]);
    await expect(editar(p.id, { agregar: [await alta('ED09')] })).rejects.toThrow(
      'Escribe el motivo del cambio.',
    );
    expect(await editar(p.id, { notas: 'Entregar el lunes' })).toMatchObject({ cambios: true });
    const antes = (await ficha(p.id)).version;
    expect(await editar(p.id, {})).toMatchObject({ cambios: false });
    expect((await ficha(p.id)).version).toBe(antes);
  });

  it('agregar es todo o nada; código en agregar y quitar a la vez se rechaza', async () => {
    const p = await crear([await alta('ED10')]);
    const otro = await crear([await alta('ED11')]);
    await expect(editar(p.id, { agregar: ['ED11'], motivo: 'x' })).rejects.toThrow(
      `No se guardó el cambio. No están disponibles: ED11 (apartada en KZR-${otro.folio}).`,
    );
    await expect(editar(p.id, { agregar: ['ED10'], quitar: ['ED10'], motivo: 'x' })).rejects.toThrow(
      'Un código no puede agregarse y quitarse a la vez: ED10.',
    );
  });

  it('solo se edita un pedido abierto y con la versión vigente', async () => {
    const p = await crear([await alta('ED12', 0)]); // liquidado al crearse
    await expect(editar(p.id, { notas: 'x' })).rejects.toThrow('Solo se edita un pedido abierto.');
    const q = await crear([await alta('ED13')]);
    const f = await ficha(q.id);
    await expect(
      app((db) =>
        editarPedido(db, {
          key: randomUUID(),
          adminId,
          pedidoId: q.id,
          version: f.version + 1,
          vendedorId: f.vendedorId,
          descuentoManualCentavos: 0,
          agregar: [],
          quitar: [],
          notas: 'x',
        }),
      ),
    ).rejects.toThrow('Otra pestaña modificó este registro. Recarga la página.');
  });

  it('la bitácora guarda el cambio de total con su motivo; las piezas, en el historial con el admin', async () => {
    const p = await crear([await alta('ED14')]);
    await editar(p.id, { agregar: [await alta('ED15')], motivo: 'Agregó otra' });
    const f = await app((db) =>
      db.execute(
        sql`SELECT campo, antes, despues, motivo FROM v_auditoria WHERE entidad = 'pedido' AND entidad_id = ${p.id}`,
      ),
    );
    expect(f.rows).toEqual([{ campo: 'total', antes: '100.00', despues: '200.00', motivo: 'Agregó otra' }]);
    const pz = (await app((db) => obtenerPiezaPorCodigo(db, 'ED15')))!;
    const m = await conDbUrl(urlOwner(), (db) =>
      db.execute(
        sql`SELECT tipo, admin_id FROM movimiento_pieza WHERE pieza_id = ${pz.id} ORDER BY orden DESC LIMIT 1`,
      ),
    );
    expect(m.rows[0]).toEqual({ tipo: 'apartado', admin_id: adminId });
  });
});

describe('editarPedido: concurrencia', () => {
  const sinCrudos = (r: PromiseSettledResult<unknown>[]) => {
    for (const x of r)
      if (x.status === 'rejected') {
        const e = x.reason as { name?: string; code?: string };
        expect(e.name).toBe('ErrorNegocio');
        expect(e.code).not.toBe('40P01');
      }
  };

  it('editar y pagar el mismo pedido terminan consistentes (total nunca bajo lo pagado)', async () => {
    const p = await crear([await alta(`EP0A`, 10000), await alta(`EP0B`, 10000)]);
    const r = await Promise.allSettled([
      editar(p.id, { quitar: [`EP0B`], motivo: 'Quitó una' }),
      app((db) =>
        registrarPagoDePedido(db, {
          key: randomUUID(),
          adminId,
          pedidoId: p.id,
          montoCentavos: 15000,
          metodo: 'efectivo',
          pagador: 'cliente',
        }),
      ),
    ]);
    sinCrudos(r);
    const f = await ficha(p.id);
    expect(Number(f.total)).toBeGreaterThanOrEqual(Number(f.pagado));
    expect(Number(f.saldo)).toBe(Number(f.total) - Number(f.pagado));
    if (f.estado === 'liquidado') expect(Number(f.saldo)).toBe(0);
  });

  it('editar y cancelar el mismo pedido terminan consistentes', async () => {
    const p = await crear([await alta(`EC0A`), await alta(`EC0B`)]);
    const nueva = await alta(`EC0C`);
    const { version } = await ficha(p.id);
    const r = await Promise.allSettled([
      editar(p.id, { agregar: [nueva], quitar: [`EC0B`], motivo: 'Cambio' }),
      app((db) => cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: p.id, version, motivo: 'x' })),
    ]);
    sinCrudos(r);
    const f = await ficha(p.id);
    const estados = await app(async (db) => [
      (await obtenerPiezaPorCodigo(db, `EC0A`))!.estado,
      (await obtenerPiezaPorCodigo(db, `EC0B`))!.estado,
      (await obtenerPiezaPorCodigo(db, nueva))!.estado,
    ]);
    if (f.estado === 'cancelado') expect(estados).toEqual(['disponible', 'disponible', 'disponible']);
    else expect(estados).toEqual(['apartada', 'disponible', 'apartada']);
  });

  it('R-05: dos pedidos que toman la misma pieza a la vez, solo uno la consigue', async () => {
    const p = await crear([await alta(`ER0A`)]);
    const q = await crear([await alta(`ER0B`)]);
    const libre = await alta(`ER0C`);
    const r = await Promise.allSettled([
      editar(p.id, { agregar: [libre], motivo: 'x' }),
      editar(q.id, { agregar: [libre], motivo: 'x' }),
    ]);
    sinCrudos(r);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const vigentes = await app((db) =>
      db.execute(
        sql`SELECT count(*)::int AS n FROM v_pedido_item WHERE codigo = ${libre} AND vigente AND pedido_estado <> 'cancelado'`,
      ),
    );
    expect(vigentes.rows[0]).toEqual({ n: 1 });
  });
});

describe('editarPedido: casos de revisión', () => {
  it('quitar una pieza cuyo exhibidor ya cerró (dato viejo) la deja disponible sin exhibidor', async () => {
    const a = await alta('ER01');
    const b = await alta('ER02');
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: 'Cerrado', fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: [b] }));
    const p = await crear([a, b]);
    // cerrarExhibidor lo impediría (tiene una apartada): se fuerza como dueño para simular datos viejos.
    await conDbUrl(urlOwner(), (db) =>
      db.execute(sql`UPDATE exhibidor SET estado = 'cerrado', cerrado_at = now() WHERE id = ${exhibidorId}`),
    );
    await editar(p.id, { quitar: [b], motivo: 'No le quedó' });
    expect((await app((db) => obtenerPiezaPorCodigo(db, b)))!).toMatchObject({
      estado: 'disponible',
      exhibidorId: null,
    });
  });

  it('agregar y quitar en la misma edición: cada línea conserva su precio final (R-11, R-27)', async () => {
    for (const c of ['ES1', 'ES2', 'ES3', 'ES4']) await crear([await alta(c, 0)]);
    const p = await crear([await alta('ES10', 10000), await alta('ES11', 20000)]);
    expect(p).toMatchObject({ posicion: { ciclo: 1, posicion: 5 }, total: '270.00' });
    expect(
      await editar(p.id, { quitar: ['ES11'], agregar: [await alta('ES12', 30000)], motivo: 'Cambio' }),
    ).toMatchObject({ total: '360.00', cambios: true });
    const items = await app((db) => db.select().from(vPedidoItem).where(eq(vPedidoItem.pedidoId, p.id)));
    const por = (codigo: string) => items.find((i) => i.codigo === codigo)!;
    expect(por('ES10')).toMatchObject({ vigente: true, precioLista: '100.00', precioFinal: '90.00' });
    expect(por('ES11')).toMatchObject({ vigente: false, precioLista: '200.00', precioFinal: '180.00' });
    expect(por('ES12')).toMatchObject({ vigente: true, precioLista: '300.00', precioFinal: '270.00' });
    expect(await ficha(p.id)).toMatchObject({ total: '360.00', piezas: 2 });
  });

  it('R-05: si varias piezas a agregar no están disponibles, el error las lista todas con su folio', async () => {
    const p = await crear([await alta('ET01')]);
    const o1 = await crear([await alta('ET02')]);
    const o2 = await crear([await alta('ET03')]);
    await expect(editar(p.id, { agregar: ['ET03', 'ET02', 'NOEXISTE'], motivo: 'x' })).rejects.toThrow(
      `No se guardó el cambio. No existen: NOEXISTE. No están disponibles: ET03 (apartada en KZR-${o2.folio}), ET02 (apartada en KZR-${o1.folio}).`,
    );
  });

  it('R-37: repetir la misma key devuelve el mismo resultado y la edición se aplica una sola vez', async () => {
    const p = await crear([await alta('EU01'), await alta('EU02', 5000)]);
    const f = await ficha(p.id);
    const datos: DatosEdicion = {
      key: randomUUID(),
      adminId,
      pedidoId: p.id,
      version: f.version,
      vendedorId: f.vendedorId,
      fecha: f.fecha,
      descuentoManualCentavos: 0,
      notas: f.notas,
      agregar: [],
      quitar: ['EU02'],
      motivo: 'Quitó una',
    };
    const r1 = await app((db) => editarPedido(db, datos));
    const r2 = await app((db) => editarPedido(db, datos)); // misma key y datos, aunque la versión ya cambió
    expect(r2).toEqual(r1);
    expect((await ficha(p.id)).version).toBe(f.version + 1);
  });

  it('inconsistente: si una pieza dejó de estar apartada, el error nombra cuál', async () => {
    const p = await crear([await alta('EV01'), await alta('EV02')]);
    await conDbUrl(urlOwner(), (db) =>
      db.execute(sql`UPDATE pieza SET estado = 'disponible', exhibidor_id = NULL WHERE codigo = 'EV02'`),
    );
    await expect(editar(p.id, { quitar: ['EV02'], motivo: 'x' })).rejects.toThrow(
      'Las piezas del pedido ya no están apartadas: EV02 (disponible). Recarga la página.',
    );
  });
});
