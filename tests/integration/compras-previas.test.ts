import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { vCliente, vPedido } from '@/db/schema';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { actualizarCliente, crearCliente } from '@/server/clientes/servicio';
import { previsualizarPedido, resumenCliente } from '@/server/pedidos/lecturas';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let vendedorId = '';
let clienteId = '';
let n = 0;

const version = () =>
  app(
    async (db) =>
      (await db.select({ v: vCliente.version }).from(vCliente).where(eq(vCliente.id, clienteId)))[0]!.v,
  );
const corregir = async (comprasPrevias: number, motivo: string | null = 'Tarjeta en papel') =>
  app(async (db) =>
    actualizarCliente(db, {
      id: clienteId,
      version: await version(),
      adminId,
      motivo,
      nombre: 'Clienta Sintética',
      comprasPrevias,
    }),
  );
const nota = async () => {
  const codigo = `CQ${String(++n).padStart(2, '0')}`;
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Aretes',
      descripcion: `Arete ${codigo}`,
      costoCentavos: 0,
      precioCentavos: 10000,
    }),
  );
  const p = await app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      clienteId,
      vendedorId,
      codigos: [codigo],
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
    }),
  );
  const [f] = await app((db) => db.select().from(vPedido).where(eq(vPedido.id, p.id)));
  return f!;
};
const falla = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e as { codigo?: string }).codigo ?? String(e),
  );

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  n = 0;
  vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla Ejemplo', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  clienteId = await app((db) => crearCliente(db, { nombre: 'Clienta Sintética' }));
});

describe('compras previas', () => {
  it('L-2: con 4 previas la nota va al lugar 5 con 10 %; la vista previa coincide', async () => {
    await corregir(4);
    const previa = await app((db) =>
      previsualizarPedido(db, { clienteId, codigos: [], cuentaTarjeta: true }),
    );
    expect(previa.tarjeta).toMatchObject({ ciclo: 1, posicion: 5, pctBps: 1000 });
    expect(await nota()).toMatchObject({ cicloTarjeta: 1, posicionTarjeta: 5, descuentoLealtadPct: '10.00' });
  });

  it('L-2: con 9 previas va al 10 con 20 %, y la siguiente a la tarjeta 2', async () => {
    await corregir(9);
    expect(await nota()).toMatchObject({ posicionTarjeta: 10, descuentoLealtadPct: '20.00' });
    expect(await nota()).toMatchObject({ cicloTarjeta: 2, posicionTarjeta: 1 });
  });

  it('L-3: cancelar una nota nueva no libera los lugares previos', async () => {
    await corregir(4);
    const a = await nota();
    await app((db) =>
      cancelarPedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: a.id,
        version: a.version,
        motivo: 'Ya no la quiere',
      }),
    );
    expect(await nota()).toMatchObject({ posicionTarjeta: 5 });
  });

  it('la ficha muestra los previos y si se pueden corregir', async () => {
    await corregir(3);
    let r = await app((db) => resumenCliente(db, clienteId));
    expect(r).toMatchObject({ comprasPrevias: 3, previasEditables: true });
    expect(r.tarjeta.casillas.filter((c) => c.estado === 'previa')).toHaveLength(3);
    await nota();
    r = await app((db) => resumenCliente(db, clienteId));
    expect(r.previasEditables).toBe(false);
  });

  it('L-5: la corrección exige motivo, queda en el historial y se bloquea con notas', async () => {
    expect(await falla(corregir(2, null))).toBe('cliente_previas_sin_motivo');
    expect(await falla(corregir(10))).toBe('cliente_invalido');
    await corregir(2, 'Tarjeta en papel');
    const h = await app((db) => historialDeCambios(db, 'cliente', clienteId));
    expect(JSON.stringify(h)).toContain('compras_previas');
    await nota();
    expect(await falla(corregir(5))).toBe('cliente_previas_con_notas');
  });

  it('el alta ignora comprasPrevias: la clienta empieza en 0', async () => {
    const id = await app((db) => crearCliente(db, { nombre: 'Otra Clienta', comprasPrevias: 4 }));
    expect((await app((db) => resumenCliente(db, id))).comprasPrevias).toBe(0);
  });

  it('editar otros datos sin tocar las compras previas no pide motivo ni las cambia', async () => {
    await corregir(4);
    await app(async (db) =>
      actualizarCliente(db, {
        id: clienteId,
        version: await version(),
        adminId,
        motivo: null,
        nombre: 'Clienta Sintética',
        telefono: '5550000000',
      }),
    );
    expect((await app((db) => resumenCliente(db, clienteId))).comprasPrevias).toBe(4);
  });
});
