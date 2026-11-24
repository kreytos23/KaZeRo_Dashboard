import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { vCliente, vPedido } from '@/db/schema';
import { hoyMX, sumarMeses } from '@/domain/fechas';
import { actualizarCliente, crearCliente } from '@/server/clientes/servicio';
import { previsualizarPedido, resumenCliente } from '@/server/pedidos/lecturas';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

// L-7 (2026-11-24): con 6 meses o más sin comprar, la siguiente nota empieza una tarjeta nueva. Datos SINTÉTICOS.
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);
let adminId = '';
let vendedorId = '';
let clienteId = '';
let n = 0;

const version = async () =>
  (await app((db) => db.select({ v: vCliente.version }).from(vCliente).where(eq(vCliente.id, clienteId))))[0]!
    .v;
const corregir = async (comprasPrevias: number) =>
  app(async (db) =>
    actualizarCliente(db, {
      id: clienteId,
      version: await version(),
      adminId,
      motivo: 'Tarjeta en papel',
      nombre: 'Clienta Sintética',
      comprasPrevias,
    }),
  );
const fechaPrevias = async () =>
  (
    await app((db) =>
      db.select({ f: vCliente.comprasPreviasFecha }).from(vCliente).where(eq(vCliente.id, clienteId)),
    )
  )[0]!.f;
/** Simula unas previas registradas hace tiempo (la columna solo la escribe el trigger o el dueño). */
const previasDel = (fecha: string) =>
  owner((db) => db.execute(sql`UPDATE cliente SET compras_previas_fecha = ${fecha} WHERE id = ${clienteId}`));
const nota = async (fecha: string) => {
  const codigo = `LV${String(++n).padStart(2, '0')}`;
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
      fecha,
    }),
  );
  const [f] = await app((db) => db.select().from(vPedido).where(eq(vPedido.id, p.id)));
  return f!;
};
const previa = (fecha: string) =>
  app((db) => previsualizarPedido(db, { clienteId, codigos: [], cuentaTarjeta: true, fecha }));

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  n = 0;
  vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla Ejemplo', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  clienteId = await app((db) => crearCliente(db, { nombre: 'Clienta Sintética' }));
});

describe('L-7: la regla de 6 meses es la misma en JS y en Postgres', () => {
  it('sumarMeses = date + interval de Postgres, día por día de 2026 a 2029 (fin de mes y bisiesto)', async () => {
    const r = await app((db) =>
      db.execute<{ d: string; v: string }>(sql`
        SELECT d::date::text AS d, (d::date + interval '6 months')::date::text AS v
        FROM generate_series(DATE '2026-01-01', DATE '2029-12-31', interval '1 day') AS d`),
    );
    expect(r.rows.length).toBeGreaterThan(1400);
    const distintas = r.rows.filter((x) => sumarMeses(x.d, 6) !== x.v);
    expect(distintas).toEqual([]);
  });
});

describe('L-7: vencimiento de la tarjeta al crear la nota', () => {
  it('a 6 meses de la última compra abre la vuelta 2 en la compra 1, sin descuento; la vista previa coincide', async () => {
    for (let i = 0; i < 4; i++) await nota('2026-01-10');
    expect(await previa('2026-07-10')).toMatchObject({
      tarjeta: { ciclo: 2, posicion: 1, pctBps: 0, nueva: true },
    });
    expect(await nota('2026-07-10')).toMatchObject({
      cicloTarjeta: 2,
      posicionTarjeta: 1,
      descuentoLealtadPct: '0.00',
    });
  });

  it('a 6 meses menos un día sigue en su tarjeta (la quinta lleva 10 %)', async () => {
    for (let i = 0; i < 4; i++) await nota('2026-01-10');
    expect(await previa('2026-07-09')).toMatchObject({
      tarjeta: { ciclo: 1, posicion: 5, pctBps: 1000, nueva: false },
    });
    expect(await nota('2026-07-09')).toMatchObject({
      cicloTarjeta: 1,
      posicionTarjeta: 5,
      descuentoLealtadPct: '10.00',
    });
  });

  it('fin de mes: la última el 31 de agosto vence el 28 de febrero, no antes', async () => {
    await nota('2025-08-31');
    expect((await previa('2026-02-27')).tarjeta).toMatchObject({ ciclo: 1, posicion: 2, nueva: false });
    expect((await previa('2026-02-28')).tarjeta).toMatchObject({ ciclo: 2, posicion: 1, nueva: true });
    expect(await nota('2026-02-28')).toMatchObject({ cicloTarjeta: 2, posicionTarjeta: 1 });
  });

  it('con previas antiguas y sin notas, la nota empieza tarjeta nueva y pedido_lugar_previo no la rechaza', async () => {
    await corregir(4);
    await previasDel('2026-01-10');
    expect(await nota('2026-07-10')).toMatchObject({ cicloTarjeta: 2, posicionTarjeta: 1 });
    // La siguiente sigue en la tarjeta nueva.
    expect(await nota('2026-07-11')).toMatchObject({ cicloTarjeta: 2, posicionTarjeta: 2 });
  });

  it('con previas recientes la nota sigue después de ellas', async () => {
    await corregir(4);
    await previasDel('2026-03-01');
    expect(await nota('2026-07-10')).toMatchObject({ cicloTarjeta: 1, posicionTarjeta: 5 });
  });

  it('una nota cancelada no cuenta como última compra', async () => {
    await nota('2026-01-10');
    const b = await nota('2026-06-01');
    await app((db) =>
      cancelarPedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: b.id,
        version: b.version,
        motivo: 'Ya no la quiere',
      }),
    );
    expect(await nota('2026-07-10')).toMatchObject({ cicloTarjeta: 2, posicionTarjeta: 1 });
  });

  it('una nota que no cuenta para la tarjeta no renueva la última compra', async () => {
    await nota('2026-01-10');
    const codigo = 'LVSIN';
    await app((db) =>
      altaPieza(db, {
        codigo,
        categoria: 'Aretes',
        descripcion: 'Arete',
        costoCentavos: 0,
        precioCentavos: 10000,
      }),
    );
    await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        clienteId,
        vendedorId,
        codigos: [codigo],
        cuentaTarjeta: false,
        descuentoManualCentavos: 0,
        fecha: '2026-06-01',
      }),
    );
    expect(await nota('2026-07-10')).toMatchObject({ cicloTarjeta: 2, posicionTarjeta: 1 });
  });
});

describe('L-7: fecha de las compras previas (trigger)', () => {
  it('la pone la BD al corregir, la renueva al cambiar el número y la quita en 0', async () => {
    expect(await fechaPrevias()).toBeNull();
    await corregir(3);
    expect(await fechaPrevias()).toBe(hoyMX());
    await previasDel('2026-01-10');
    // Editar otros datos sin cambiar el número no la renueva.
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
    expect(await fechaPrevias()).toBe('2026-01-10');
    await corregir(5);
    expect(await fechaPrevias()).toBe(hoyMX());
    await corregir(0);
    expect(await fechaPrevias()).toBeNull();
  });

  it('un alta con previas (importación) también la recibe', async () => {
    const r = await owner((db) =>
      db.execute<{ f: string | null }>(
        sql`INSERT INTO cliente (nombre, compras_previas) VALUES ('Otra Sintética', 2) RETURNING compras_previas_fecha::text AS f`,
      ),
    );
    expect(r.rows[0]!.f).toBe(hoyMX());
  });

  it('kazero_app no puede escribirla', async () => {
    await expect(
      app((db) =>
        db.execute(sql`UPDATE cliente SET compras_previas_fecha = '2020-01-01' WHERE id = ${clienteId}`),
      ),
    ).rejects.toThrow();
  });
});

describe('L-7: la ficha de la clienta', () => {
  it('vigente: muestra sus compras y cuándo vence', async () => {
    await corregir(3);
    const hoy = hoyMX();
    const r = await app((db) => resumenCliente(db, clienteId, hoy));
    expect(r.vencimiento).toEqual({ ultimaCompra: hoy, vence: sumarMeses(hoy, 6), vencida: false });
    expect(r.tarjeta.ocupadas).toBe(3);
  });

  it('vencida: la tarjeta se ve vacía y previasEditables sigue igual', async () => {
    await corregir(3);
    await previasDel('2025-12-01');
    await nota('2026-01-10'); // compra 4 de la tarjeta 1 (las previas aún no vencían)
    const r = await app((db) => resumenCliente(db, clienteId, '2026-07-10'));
    expect(r.vencimiento).toMatchObject({ ultimaCompra: '2026-01-10', vencida: true });
    expect(r.tarjeta.ocupadas).toBe(0);
    expect(r.previasEditables).toBe(false);
  });
});
