import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { movimientoPieza, pieza, vPedido, vPieza } from '@/db/schema';
import { construirIndice } from '@/server/busqueda/indice';
import { crearCliente } from '@/server/clientes/servicio';
import { crearExhibidor, enviarPiezas } from '@/server/exhibidores/servicio';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { cancelarPedido, crearPedido, editarPedido } from '@/server/pedidos/servicio';
import { entregarAVendedora, piezasDeVendedora, regresarAKazero } from '@/server/piezas/custodia';
import {
  altaPieza,
  cambiarEstado,
  deshacerUltimoCambio,
  contarPiezas,
  listarPiezas,
  obtenerPiezaPorCodigo,
} from '@/server/piezas/servicio';
import { actualizarVendedor, crearVendedor, obtenerVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let ids: { nelly: string; lupita: string; casa: string; cliente: string };

async function alta(codigo: string, precioCentavos = 10000) {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Anillos',
      descripcion: `Anillo ${codigo}`,
      costoCentavos: 0,
      precioCentavos,
    }),
  );
  return codigo;
}
const entregar = (vendedorId: string, codigos: string[]) =>
  app((db) => entregarAVendedora(db, { adminId, vendedorId, codigos }));
const regresar = (vendedorId: string, codigos: string[]) =>
  app((db) => regresarAKazero(db, { adminId, vendedorId, codigos }));
const crear = (vendedorId: string, codigos: string[]) =>
  app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      clienteId: ids.cliente,
      vendedorId,
      codigos,
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
    }),
  );
const ficha = (codigo: string) =>
  app(async (db) => (await db.select().from(vPieza).where(eq(vPieza.codigo, codigo)))[0]!);
const custodiaDe = async (codigo: string) =>
  (
    await app((db) => db.select({ c: pieza.vendedorCustodiaId }).from(pieza).where(eq(pieza.codigo, codigo)))
  )[0]!.c;
const movimientos = (piezaId: string) =>
  app((db) =>
    db
      .select()
      .from(movimientoPieza)
      .where(eq(movimientoPieza.piezaId, piezaId))
      .orderBy(desc(movimientoPieza.orden)),
  );

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  ids = {
    nelly: await app((db) =>
      crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' }),
    ),
    lupita: await app((db) =>
      crearVendedor(db, { nombre: 'Lupita', tipo: 'revendedora', comisionPct: '15.00' }),
    ),
    casa: await app((db) => crearVendedor(db, { nombre: 'Kazero', tipo: 'casa', comisionPct: '0.00' })),
    cliente: await app((db) => crearCliente(db, { nombre: 'Gloria' })),
  };
});

describe('entregar a vendedora', () => {
  it('deja las piezas disponibles con su custodia, la ubicación derivada y el movimiento', async () => {
    await alta('CU01');
    await alta('CU02');
    expect(await entregar(ids.nelly, ['cu01', ' CU02 '])).toEqual({ entregadas: 2 });
    const f = await ficha('CU01');
    expect(f).toMatchObject({
      estado: 'disponible',
      vendedorCustodiaId: ids.nelly,
      vendedorCustodiaNombre: 'Nelly',
      ubicacion: 'vendedora',
    });
    expect((await movimientos(f.id))[0]).toMatchObject({
      tipo: 'entrega_vendedora',
      deEstado: 'disponible',
      aEstado: 'disponible',
      vendedorId: ids.nelly,
      adminId,
    });
    expect((await app((db) => piezasDeVendedora(db, ids.nelly))).map((p) => p.codigo)).toEqual([
      'CU01',
      'CU02',
    ]);
  });

  it('todo o nada: lista exhibidor, otra vendedora y vendida en el orden escrito, sin cambiar nada', async () => {
    for (const c of ['CU11', 'CU12', 'CU13', 'CU14', 'CU15']) await alta(c);
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ids.nelly, nombre: 'Nelly 1', fechaEnvio: '2026-09-16' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['CU11'] }));
    await entregar(ids.lupita, ['CU12']);
    await app(async (db) => {
      const p = (await obtenerPiezaPorCodigo(db, 'CU13'))!;
      await cambiarEstado(db, { piezaId: p.id, version: p.version, aEstado: 'regalo', adminId });
    });
    await expect(entregar(ids.nelly, ['CU13', 'NOEXISTE', 'CU11', 'CU12', 'CU15'])).rejects.toThrow(
      'No se entregó nada. No existen: NOEXISTE. No están disponibles en Kazero: CU13 (regalo), CU11 (en exhibidor Nelly 1), CU12 (la tiene Lupita).',
    );
    expect(await custodiaDe('CU15')).toBeNull();
    expect(await custodiaDe('CU12')).toBe(ids.lupita);
    // Entregar otra vez a la misma vendedora: ya la tiene.
    await entregar(ids.nelly, ['CU14']);
    await expect(entregar(ids.nelly, ['CU14'])).rejects.toThrow('CU14 (ya la tiene Nelly)');
  });

  it('rechaza una vendedora inactiva, la casa, una que no existe y listas vacías', async () => {
    await alta('CU21');
    const v = (await app((db) => obtenerVendedor(db, ids.lupita)))!;
    await app((db) => actualizarVendedor(db, { ...v, adminId, activo: false }));
    await expect(entregar(ids.lupita, ['CU21'])).rejects.toThrow('La vendedora está inactiva.');
    await expect(entregar(ids.casa, ['CU21'])).rejects.toThrow('Kazero es la casa: elige una vendedora.');
    await expect(entregar(randomUUID(), ['CU21'])).rejects.toThrow('La vendedora no existe.');
    await expect(entregar(ids.nelly, [' '])).rejects.toThrow('Escribe al menos un código.');
    expect(await custodiaDe('CU21')).toBeNull();
  });
});

describe('regresar a Kazero', () => {
  it('vuelve a Kazero con su movimiento regreso_vendedora', async () => {
    await alta('CU31');
    await entregar(ids.nelly, ['CU31']);
    expect(await regresar(ids.nelly, ['CU31'])).toEqual({ regresadas: 1 });
    const f = await ficha('CU31');
    expect(f).toMatchObject({ estado: 'disponible', vendedorCustodiaId: null, ubicacion: 'kazero' });
    expect((await movimientos(f.id))[0]).toMatchObject({
      tipo: 'regreso_vendedora',
      vendedorId: ids.nelly,
      adminId,
    });
  });

  it('rechaza la que tiene otra vendedora, la que está en Kazero y la apartada (con su folio)', async () => {
    await alta('CU41');
    await alta('CU42');
    await alta('CU43');
    await entregar(ids.lupita, ['CU41']);
    await expect(regresar(ids.nelly, ['CU41'])).rejects.toThrow(
      'No se regresó nada. No las tiene Nelly: CU41.',
    );
    await expect(regresar(ids.nelly, ['CU42', 'NOEXISTE'])).rejects.toThrow(
      'No se regresó nada. No existen: NOEXISTE. No las tiene Nelly: CU42.',
    );
    await entregar(ids.nelly, ['CU43']);
    const p = await crear(ids.nelly, ['CU43']);
    await expect(regresar(ids.nelly, ['CU43'])).rejects.toThrow(
      `No las tiene Nelly disponibles: CU43 (apartada en KZR-${p.folio})`,
    );
    expect(await custodiaDe('CU43')).toBe(ids.nelly);
  });
});

describe('vender una pieza en poder de una vendedora', () => {
  it('apartada conserva la custodia; al liquidar sale de ella y la venta guarda a la vendedora', async () => {
    await alta('CU51', 10000);
    await entregar(ids.nelly, ['CU51']);
    const p = await crear(ids.nelly, ['CU51']);
    expect(await ficha('CU51')).toMatchObject({ estado: 'apartada', vendedorCustodiaId: ids.nelly });
    const pz = await ficha('CU51');
    expect((await movimientos(pz.id))[0]).toMatchObject({ tipo: 'apartado', vendedorId: ids.nelly });
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
    expect(await ficha('CU51')).toMatchObject({
      estado: 'vendida',
      vendedorCustodiaId: null,
      ubicacion: 'fuera',
    });
    expect((await movimientos(pz.id))[0]).toMatchObject({ tipo: 'venta', vendedorId: ids.nelly });
    expect(await app((db) => piezasDeVendedora(db, ids.nelly))).toEqual([]);
  });

  it('P2: la nota de otra vendedora (o de la casa) no puede vender la pieza', async () => {
    await alta('CU61');
    await entregar(ids.nelly, ['CU61']);
    await expect(crear(ids.lupita, ['CU61'])).rejects.toThrow(
      'CU61 la tiene Nelly: la nota debe ser de Nelly, o regrésala a Kazero.',
    );
    await expect(crear(ids.casa, ['CU61'])).rejects.toThrow('CU61 la tiene Nelly');
    expect(await ficha('CU61')).toMatchObject({ estado: 'disponible', vendedorCustodiaId: ids.nelly });
  });

  it('P2 en edición: cambiar el vendedor de la nota o agregar una pieza ajena se rechaza', async () => {
    await alta('CU71');
    await alta('CU72');
    await alta('CU73');
    await entregar(ids.nelly, ['CU71']);
    await entregar(ids.lupita, ['CU72']);
    const p = await crear(ids.nelly, ['CU71']);
    const base = async () => {
      const { version } = await app(
        async (db) => (await db.select().from(vPedido).where(eq(vPedido.id, p.id)))[0]!,
      );
      return {
        key: randomUUID(),
        adminId,
        pedidoId: p.id,
        version,
        vendedorId: ids.nelly,
        descuentoManualCentavos: 0,
        motivo: 'Cambio de piezas',
        agregar: [] as string[],
        quitar: [] as string[],
      };
    };
    await expect(
      app(async (db) => editarPedido(db, { ...(await base()), vendedorId: ids.lupita })),
    ).rejects.toThrow('CU71 la tiene Nelly: la nota debe ser de Nelly');
    await expect(
      app(async (db) => editarPedido(db, { ...(await base()), agregar: ['CU72'] })),
    ).rejects.toThrow('CU72 la tiene Lupita');
    // Cambiar a Lupita quitando la de Nelly y agregando la de Lupita sí es coherente.
    await app(async (db) =>
      editarPedido(db, { ...(await base()), vendedorId: ids.lupita, agregar: ['CU72'], quitar: ['CU71'] }),
    );
    // Una pieza sin vendedora (en Kazero) se puede vender en cualquier nota.
    await app(async (db) =>
      editarPedido(db, { ...(await base()), vendedorId: ids.lupita, agregar: ['CU73'] }),
    );
    expect(await ficha('CU73')).toMatchObject({ estado: 'apartada', vendedorCustodiaId: null });
  });

  it('cancelar el pedido deja la pieza disponible con la misma vendedora', async () => {
    await alta('CU81');
    await entregar(ids.nelly, ['CU81']);
    const p = await crear(ids.nelly, ['CU81']);
    const { version } = await app(
      async (db) => (await db.select().from(vPedido).where(eq(vPedido.id, p.id)))[0]!,
    );
    await app((db) =>
      cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: p.id, version, motivo: 'Ya no la quiere' }),
    );
    const f = await ficha('CU81');
    expect(f).toMatchObject({ estado: 'disponible', vendedorCustodiaId: ids.nelly, ubicacion: 'vendedora' });
    expect((await movimientos(f.id))[0]).toMatchObject({ tipo: 'liberacion', vendedorId: ids.nelly });
  });
});

describe('otros flujos con una pieza en poder de una vendedora', () => {
  it('enviar a exhibidor se rechaza con el nombre de quien la tiene', async () => {
    await alta('CU91');
    await entregar(ids.nelly, ['CU91']);
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ids.nelly, nombre: 'Nelly 1', fechaEnvio: '2026-09-16' }),
    );
    await expect(app((db) => enviarPiezas(db, { exhibidorId, codigos: ['CU91'] }))).rejects.toThrow(
      'No se envió nada. No están disponibles: CU91 (la tiene Nelly).',
    );
    expect(await ficha('CU91')).toMatchObject({ estado: 'disponible', ubicacion: 'vendedora' });
  });

  it('cambio manual a defecto la saca de la custodia y deshacer la deja en Kazero', async () => {
    await alta('CUA1');
    await entregar(ids.nelly, ['CUA1']);
    const antes = await ficha('CUA1');
    await app((db) =>
      cambiarEstado(db, { piezaId: antes.id, version: antes.version, aEstado: 'defecto', adminId }),
    );
    const f = await ficha('CUA1');
    expect(f).toMatchObject({ estado: 'defecto', vendedorCustodiaId: null, ubicacion: 'kazero' });
    expect((await movimientos(f.id))[0]).toMatchObject({ tipo: 'cambio_estado', vendedorId: ids.nelly });
    await app((db) =>
      deshacerUltimoCambio(db, { piezaId: f.id, version: f.version, adminId, motivo: 'Fue un error' }),
    );
    expect(await ficha('CUA1')).toMatchObject({
      estado: 'disponible',
      vendedorCustodiaId: null,
      ubicacion: 'kazero',
    });
  });

  it('concurrencia: entregar y vender a la vez deja un estado coherente', async () => {
    await alta('CUB1');
    const [e, c] = await Promise.allSettled([entregar(ids.nelly, ['CUB1']), crear(ids.lupita, ['CUB1'])]);
    const f = await ficha('CUB1');
    if (e.status === 'fulfilled') {
      // Ganó la entrega: el pedido de Lupita se rechaza por P2.
      expect(c.status).toBe('rejected');
      expect(f).toMatchObject({ estado: 'disponible', vendedorCustodiaId: ids.nelly });
    } else {
      // Ganó el pedido: la pieza quedó apartada sin custodia y la entrega se rechazó.
      expect(c.status).toBe('fulfilled');
      expect(f).toMatchObject({ estado: 'apartada', vendedorCustodiaId: null });
    }
  });
});

describe('ubicación visible', () => {
  it('listarPiezas filtra por ubicación y vendedora, y trae la etiqueta «Con Nelly»', async () => {
    await alta('CUC1');
    await alta('CUC2');
    await alta('CUC3');
    await entregar(ids.nelly, ['CUC1']);
    await entregar(ids.lupita, ['CUC2']);
    const conNelly = await app((db) => listarPiezas(db, { ubicacion: 'vendedora', vendedorId: ids.nelly }));
    expect(conNelly.map((p) => [p.codigo, p.ubicacionEtiqueta])).toEqual([['CUC1', 'Con Nelly']]);
    expect((await app((db) => listarPiezas(db, { ubicacion: 'vendedora' }))).map((p) => p.codigo)).toEqual([
      'CUC1',
      'CUC2',
    ]);
    expect((await app((db) => listarPiezas(db, { ubicacion: 'kazero' }))).map((p) => p.codigo)).toEqual([
      'CUC3',
    ]);
    // El conteo usa los mismos filtros que el listado y no depende de limite/offset.
    for (const fl of [
      { ubicacion: 'vendedora' as const, vendedorId: ids.nelly },
      { ubicacion: 'vendedora' as const },
      { ubicacion: 'kazero' as const },
      { q: 'cuc' },
      {},
    ]) {
      expect(await app((db) => contarPiezas(db, fl))).toBe((await app((db) => listarPiezas(db, fl))).length);
    }
    expect(await app((db) => contarPiezas(db, { ubicacion: 'vendedora' }))).toBe(2);
    expect(await app((db) => contarPiezas(db, {}))).toBe(3);
    expect((await app((db) => listarPiezas(db, { limite: 1, offset: 2 }))).map((p) => p.codigo)).toEqual([
      'CUC3',
    ]);
    expect(await app((db) => contarPiezas(db, { limite: 1, offset: 2 }))).toBe(3);
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'CUC1')))!.ubicacionEtiqueta).toBe('Con Nelly');
  });

  it('el índice v4 trae la etiqueta de ubicación solo cuando no está en Kazero', async () => {
    await alta('CUD1');
    await alta('CUD2');
    await entregar(ids.nelly, ['CUD1']);
    const idx = await app((db) => construirIndice(db));
    expect(idx.v).toBe(4);
    const por = new Map(idx.piezas.map((p) => [p[1], p]));
    expect(por.get('CUD1')![5]).toBe('Con Nelly');
    expect(por.get('CUD2')![5]).toBeNull();
  });
});
