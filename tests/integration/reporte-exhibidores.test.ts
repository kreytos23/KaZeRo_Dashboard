import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pago, vExhibidor, vPedido } from '@/db/schema';
import { mesAnterior, mesDe, mesSiguiente } from '@/domain/comisiones';
import { hoyMX } from '@/domain/fechas';
import { crearCliente } from '@/server/clientes/servicio';
import { registrarEntregaExhibidor, registrarVentaExhibidor } from '@/server/exhibidores/dinero';
import { porEntregarCentavos } from '@/server/exhibidores/lecturas-dinero';
import { crearExhibidor, enviarPiezas, regresarPiezas } from '@/server/exhibidores/servicio';
import { anularPago } from '@/server/pagos/anular';
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
const hoja = async () => {
  const r = await app((db) => reporteExhibidores(db, { mes, hoy }));
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
  it('cuadra piezas con envío, venta y regreso, y coincide con la ficha', async () => {
    await enviar('RX01', 'RX02', 'RX03');
    await venta(['RX01'], 5000);
    await app((db) => regresarPiezas(db, { exhibidorId, codigos: ['RX02'] }));
    const h = await hoja();
    expect(h.piezas).toEqual({
      alInicio: 0,
      enviadas: 3,
      vendidas: 1,
      regresadas: 1,
      porCancelacion: 0,
      otros: 0,
      alCierre: 1,
    });
    expect(h.piezas.alCierre).toBe(await piezasFicha());
    expect(h.piezasAlCierre).toEqual([{ codigo: 'RX03', descripcion: 'Arete RX03', precioCentavos: 10000 }]);
  });

  it('X-3: la venta con saldo sale por nota, con cobrado y saldo', async () => {
    await enviar('RX04', 'RX05');
    const v = await venta(['RX04', 'RX05'], 5000);
    const h = await hoja();
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
    expect(h.piezas).toMatchObject({ vendidas: 1, porCancelacion: 1, alCierre: 1 });
    expect(h.ventas[0]).toMatchObject({ estado: 'cancelado' });
    expect(h.piezas.alCierre).toBe(await piezasFicha());
  });

  it('el dinero al cierre coincide con el por entregar, sin pagos deshechos', async () => {
    await enviar('RX07', 'RX08');
    await venta(['RX07'], 8000);
    await venta(['RX08'], 3000);
    await app((db) =>
      registrarEntregaExhibidor(db, {
        key: randomUUID(),
        adminId,
        exhibidorId,
        montoCentavos: 2000,
        metodo: 'efectivo',
      }),
    );
    const [cobro] = await app((db) =>
      db
        .select({ id: pago.id })
        .from(pago)
        .where(eq(pago.exhibidorId, exhibidorId))
        .orderBy(asc(pago.createdAt))
        .limit(1),
    );
    await app((db) =>
      anularPago(db, { key: randomUUID(), adminId, pagoId: cobro!.id, motivo: 'Mal capturado' }),
    );
    const h = await hoja();
    expect(h.dinero.alCierre).toBe(await app((db) => porEntregarCentavos(db, exhibidorId)));
    // Se anuló el primer cobro (8000): queda cobrado el segundo (3000).
    expect(h.dinero.cobrado).toBe(3000);
    expect(h.dinero.entregado).toBe(2000);
  });

  it('el mes siguiente arranca donde cerró este y el anterior no tiene hoja', async () => {
    await enviar('RX09');
    const siguiente = await app((db) => reporteExhibidores(db, { mes: mesSiguiente(mes), hoy }));
    expect(siguiente.hojas.find((h) => h.exhibidorId === exhibidorId)?.piezas.alInicio).toBe(1);
    const anterior = await app((db) => reporteExhibidores(db, { mes: mesAnterior(mes), hoy }));
    expect(anterior.hojas.find((h) => h.exhibidorId === exhibidorId)).toBeUndefined();
  });

  it('X-1: la hoja no trae costo ni datos de clientas', async () => {
    await alta('RX10', 4321);
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['RX10'] }));
    await venta(['RX10'], 0);
    const texto = JSON.stringify(await hoja());
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
    const pasado = await app((db) => reporteExhibidores(db, { mes: mesAnterior(mes), hoy }));
    expect(pasado.enCurso).toBe(false);
  });
});
