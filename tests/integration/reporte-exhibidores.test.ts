import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { vExhibidor, vPedido } from '@/db/schema';
import { mesAnterior, mesDe, mesSiguiente } from '@/domain/comisiones';
import { hoyMX } from '@/domain/fechas';
import { crearCliente } from '@/server/clientes/servicio';
import { registrarVentaExhibidor } from '@/server/exhibidores/dinero';
import { crearExhibidor, enviarPiezas, regresarPiezas } from '@/server/exhibidores/servicio';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { cancelarPedido } from '@/server/pedidos/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { reporteExhibidores } from '@/server/reportes/exhibidores';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const hoy = hoyMX();
const mes = mesDe(hoy);
let adminId = '';
let vendedorId = '';
let clienteId = '';
let exhibidorId = '';

const alta = (codigo: string, costoCentavos = 4000) =>
  app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Aretes',
      descripcion: `Arete ${codigo}`,
      costoCentavos,
      precioCentavos: 10000,
    }),
  );
const enviar = async (...codigos: string[]) => {
  for (const c of codigos) await alta(c);
  await app((db) => enviarPiezas(db, { exhibidorId, codigos }));
};
const venta = (codigos: string[], cobradoCentavos: number) =>
  app((db) =>
    registrarVentaExhibidor(db, {
      key: randomUUID(),
      adminId,
      exhibidorId,
      codigos,
      clienteId,
      cobradoCentavos,
      metodo: 'efectivo',
    }),
  );
const hoja = async (ventas = false) => {
  const r = await app((db) => reporteExhibidores(db, { mes, hoy, ventas }));
  return r.hojas.find((h) => h.exhibidorId === exhibidorId)!;
};
const piezasFicha = () =>
  app(async (db) => {
    const [e] = await db
      .select({ n: vExhibidor.piezasActuales })
      .from(vExhibidor)
      .where(eq(vExhibidor.id, exhibidorId));
    return e!.n;
  });

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  clienteId = await app((db) => crearCliente(db, { nombre: 'Clienta Sintética', telefono: '5550000000' }));
  vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla Ejemplo', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  exhibidorId = await app((db) =>
    crearExhibidor(db, { vendedorId, nombre: 'Salón Prueba', fechaEnvio: '2026-10-01' }),
  );
});

describe('reporte mensual de exhibidores', () => {
  it('tras envío, venta y regreso quedan las piezas de la ficha, con código, descripción y precio', async () => {
    await enviar('RX01', 'RX02', 'RX03');
    await venta(['RX01'], 5000);
    await app((db) => regresarPiezas(db, { exhibidorId, codigos: ['RX02'] }));
    const h = await hoja();
    expect(h.piezasAlCierre).toHaveLength(await piezasFicha());
    expect(h.piezasAlCierre).toEqual([{ codigo: 'RX03', descripcion: 'Arete RX03', precioCentavos: 10000 }]);
  });

  it('X-3: la venta con saldo sale por nota, con cobrado y saldo', async () => {
    await enviar('RX04', 'RX05');
    const v = await venta(['RX04', 'RX05'], 5000);
    const h = await hoja(true);
    expect(h.ventas).toHaveLength(1);
    expect(h.ventas[0]).toMatchObject({
      pedidoId: v.pedidoId,
      folio: v.folio,
      piezas: 2,
      totalCentavos: 20000,
      cobradoCentavos: 5000,
      saldoCentavos: 15000,
      estado: 'abierto',
    });
  });

  it('X-4: cancelar devuelve la pieza y deja la venta con su estado', async () => {
    await enviar('RX06');
    const v = await venta(['RX06'], 0);
    const [p] = await app((db) => db.select().from(vPedido).where(eq(vPedido.id, v.pedidoId)));
    await app((db) =>
      cancelarPedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: v.pedidoId,
        version: p!.version,
        motivo: 'Ya no la quiere',
      }),
    );
    const h = await hoja();
    expect(h.piezasAlCierre.map((z) => z.codigo)).toEqual(['RX06']);
    expect(h.ventas[0]).toMatchObject({ estado: 'cancelado' });
    expect(h.piezasAlCierre).toHaveLength(await piezasFicha());
  });

  it('si se vendió todo, la hoja sale por la venta del mes aunque no queden piezas', async () => {
    await enviar('RX07');
    const v = await venta(['RX07'], 3000);
    const h = await hoja(true);
    expect(h.piezasAlCierre).toEqual([]);
    expect(h.ventas.map((x) => x.pedidoId)).toEqual([v.pedidoId]);
    // Sin pedir las ventas, una hoja sin piezas no sale.
    expect(await hoja()).toBeUndefined();
  });

  it('un exhibidor con solo un cobro en el mes y sin piezas no tiene hoja', async () => {
    await enviar('RX08');
    const v = await venta(['RX08'], 0);
    const cobros = await app((db) =>
      crearExhibidor(db, { vendedorId, nombre: 'Salón Cobros', fechaEnvio: '2026-10-01' }),
    );
    await app((db) =>
      registrarPagoDePedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: v.pedidoId,
        montoCentavos: 2000,
        metodo: 'efectivo',
        pagador: 'cliente',
        exhibidorId: cobros,
      }),
    );
    const r = await app((db) => reporteExhibidores(db, { mes, hoy, ventas: true }));
    expect(r.hojas.find((x) => x.exhibidorId === cobros)).toBeUndefined();
    expect(r.hojas.find((x) => x.exhibidorId === exhibidorId)).toBeDefined();
  });

  it('un exhibidor abierto sin movimiento en el mes pero con piezas sí tiene hoja; antes de enviarlas no', async () => {
    await enviar('RX09');
    const siguiente = await app((db) => reporteExhibidores(db, { mes: mesSiguiente(mes), hoy }));
    const h = siguiente.hojas.find((x) => x.exhibidorId === exhibidorId);
    expect(h?.piezasAlCierre.map((z) => z.codigo)).toEqual(['RX09']);
    expect(h?.ventas).toEqual([]);
    const anterior = await app((db) => reporteExhibidores(db, { mes: mesAnterior(mes), hoy }));
    expect(anterior.hojas.find((x) => x.exhibidorId === exhibidorId)).toBeUndefined();
  });

  it('un exhibidor sin piezas ni ventas no tiene hoja', async () => {
    const r = await app((db) => reporteExhibidores(db, { mes, hoy }));
    expect(r.hojas.find((x) => x.exhibidorId === exhibidorId)).toBeUndefined();
  });

  it('X-1: la hoja no trae costo ni datos de clientas', async () => {
    await alta('RX10', 4321);
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['RX10'] }));
    await venta(['RX10'], 0);
    const texto = JSON.stringify(await hoja(true));
    expect(texto).not.toContain('Sintética');
    expect(texto).not.toContain('5550000000');
    expect(texto.toLowerCase()).not.toContain('costo');
    expect(texto).not.toContain('4321');
    expect(texto).not.toContain('43.21');
  });

  it('un mes futuro se marca en curso, igual que el actual, y el pasado no', async () => {
    const futuro = await app((db) => reporteExhibidores(db, { mes: mesSiguiente(mes), hoy }));
    expect(futuro.enCurso).toBe(true);
    const actual = await app((db) => reporteExhibidores(db, { mes, hoy }));
    expect(actual.enCurso).toBe(true);
    expect(actual.hoy).toBe(hoy); // la «Fecha de entrega» de la hoja
    const pasado = await app((db) => reporteExhibidores(db, { mes: mesAnterior(mes), hoy }));
    expect(pasado.enCurso).toBe(false);
  });
});
