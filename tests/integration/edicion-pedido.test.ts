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
import { adminDePrueba, truncarTodo, urlApp, urlOwner } from './utilidades';

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
  await truncarTodo();
  adminId = await adminDePrueba();
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
    for (let ronda = 0; ronda < 3; ronda++) {
      const p = await crear([await alta(`EP${ronda}A`, 10000), await alta(`EP${ronda}B`, 10000)]);
      const r = await Promise.allSettled([
        editar(p.id, { quitar: [`EP${ronda}B`], motivo: 'Quitó una' }),
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
    }
  });

  it('editar y cancelar el mismo pedido terminan consistentes', async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const p = await crear([await alta(`EC${ronda}A`), await alta(`EC${ronda}B`)]);
      const nueva = await alta(`EC${ronda}C`);
      const { version } = await ficha(p.id);
      const r = await Promise.allSettled([
        editar(p.id, { agregar: [nueva], quitar: [`EC${ronda}B`], motivo: 'Cambio' }),
        app((db) => cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: p.id, version, motivo: 'x' })),
      ]);
      sinCrudos(r);
      const f = await ficha(p.id);
      const estados = await app(async (db) => [
        (await obtenerPiezaPorCodigo(db, `EC${ronda}A`))!.estado,
        (await obtenerPiezaPorCodigo(db, `EC${ronda}B`))!.estado,
        (await obtenerPiezaPorCodigo(db, nueva))!.estado,
      ]);
      if (f.estado === 'cancelado') expect(estados).toEqual(['disponible', 'disponible', 'disponible']);
      else expect(estados).toEqual(['apartada', 'disponible', 'apartada']);
    }
  });

  it('R-05: dos pedidos que toman la misma pieza a la vez, solo uno la consigue', async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const p = await crear([await alta(`ER${ronda}A`)]);
      const q = await crear([await alta(`ER${ronda}B`)]);
      const libre = await alta(`ER${ronda}C`);
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
    }
  });
});
