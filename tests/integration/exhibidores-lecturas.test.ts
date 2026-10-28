import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { numericACentavos } from '@/domain/dinero';
import { crearCliente } from '@/server/clientes/servicio';
import {
  registrarAjusteExhibidor,
  registrarEntregaExhibidor,
  registrarVentaExhibidor,
} from '@/server/exhibidores/dinero';
import {
  exhibidoresPorEntregar,
  historialDineroExhibidor,
  ventasDeExhibidor,
} from '@/server/exhibidores/lecturas-dinero';
import { crearExhibidor, enviarPiezas, obtenerExhibidor } from '@/server/exhibidores/servicio';
import { crearPedido } from '@/server/pedidos/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

// Plan 4a, Task 3: lecturas del dinero del exhibidor.
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const PRECIO = 10000;
/** El resumen de dinero que lee la ficha: sale de la vista del exhibidor. */
const resumenDelExhibidor = async (id: string) => {
  const e = (await app((db) => obtenerExhibidor(db, id)))!;
  return {
    cobradoCentavos: numericACentavos(e.cobrado),
    entregadoCentavos: numericACentavos(e.entregado),
    ajustesCentavos: numericACentavos(e.ajustes),
    porEntregarCentavos: numericACentavos(e.porEntregar),
  };
};
let adminId = '';
let perlaId = '';
let gloriaId = '';
let luzId = '';
let solId = '';

async function pieza(codigo: string) {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Aretes',
      descripcion: `Arete ${codigo}`,
      costoCentavos: 0,
      precioCentavos: PRECIO,
    }),
  );
}
async function enExhibidor(exhibidorId: string, ...codigos: string[]) {
  for (const c of codigos) await pieza(c);
  await app((db) => enviarPiezas(db, { exhibidorId, codigos }));
}
const venta = (
  exhibidorId: string,
  codigos: string[],
  o: { clienteId?: string | null; cobrado?: number } = {},
) =>
  app((db) =>
    registrarVentaExhibidor(db, {
      key: randomUUID(),
      adminId,
      exhibidorId,
      codigos,
      clienteId: o.clienteId ?? null,
      cobradoCentavos: o.cobrado ?? PRECIO,
      metodo: 'efectivo',
    }),
  );

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  perlaId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla', tipo: 'revendedora', comisionPct: '18.00' }),
  );
  gloriaId = await app((db) => crearCliente(db, { nombre: 'Gloria' }));
  luzId = await app((db) =>
    crearExhibidor(db, { vendedorId: perlaId, nombre: 'Estética Luz', fechaEnvio: '2026-10-01' }),
  );
  solId = await app((db) =>
    crearExhibidor(db, { vendedorId: perlaId, nombre: 'Boutique Sol', fechaEnvio: '2026-10-01' }),
  );
});

describe('lecturas de dinero del exhibidor', () => {
  it('sin movimientos: todo en cero, sin historial ni ventas', async () => {
    expect(await resumenDelExhibidor(luzId)).toEqual({
      cobradoCentavos: 0,
      entregadoCentavos: 0,
      ajustesCentavos: 0,
      porEntregarCentavos: 0,
    });
    expect(await app((db) => historialDineroExhibidor(db, luzId))).toEqual([]);
    expect(await app((db) => ventasDeExhibidor(db, luzId))).toEqual([]);
  });

  it('resumen e historial: cobro, entrega y ajuste, el más reciente primero', async () => {
    await enExhibidor(luzId, 'LZ01', 'LZ02');
    const v = await venta(luzId, ['LZ01', 'LZ02'], { clienteId: gloriaId, cobrado: 15000 });
    await app((db) =>
      registrarEntregaExhibidor(db, {
        key: randomUUID(),
        adminId,
        exhibidorId: luzId,
        montoCentavos: 5000,
        metodo: 'transferencia',
        nota: 'Pasó Perla',
      }),
    );
    await app((db) =>
      registrarAjusteExhibidor(db, {
        key: randomUUID(),
        adminId,
        exhibidorId: luzId,
        montoCentavos: -1000,
        motivo: 'Corrección de caja',
      }),
    );
    expect(await resumenDelExhibidor(luzId)).toEqual({
      cobradoCentavos: 15000,
      entregadoCentavos: 5000,
      ajustesCentavos: -1000,
      porEntregarCentavos: 9000,
    });
    const h = await app((db) => historialDineroExhibidor(db, luzId));
    expect(h.map((m) => m.tipo)).toEqual(['ajuste', 'entrega', 'cobro']);
    expect(h[0]).toMatchObject({
      montoCentavos: -1000,
      folio: null,
      metodo: null,
      nota: 'Corrección de caja',
      adminNombre: 'auditor@kazero.test',
    });
    expect(h[1]).toMatchObject({ montoCentavos: 5000, metodo: 'transferencia', nota: 'Pasó Perla' });
    expect(h[2]).toMatchObject({
      montoCentavos: 15000,
      folio: v.folio,
      clienteNombre: 'Gloria',
      metodo: 'efectivo',
    });
  });

  it('ventas: la venta en un paso (mostrador y con clienta) y una nota normal con pieza del exhibidor', async () => {
    await enExhibidor(luzId, 'LZ01', 'LZ02', 'LZ03');
    await enExhibidor(solId, 'SL01');
    const v1 = await venta(luzId, ['LZ01']);
    const v2 = await venta(luzId, ['LZ02'], { clienteId: gloriaId, cobrado: 4000 });
    const normal = await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        clienteId: gloriaId,
        vendedorId: perlaId,
        codigos: ['LZ03'],
        cuentaTarjeta: true,
        descuentoManualCentavos: 0,
      }),
    );
    await venta(solId, ['SL01']);
    const r = await app((db) => ventasDeExhibidor(db, luzId));
    expect(r.map((x) => x.folio).sort()).toEqual([v1.folio, v2.folio, normal.folio].sort());
    const porFolio = new Map(r.map((x) => [x.folio, x]));
    expect(porFolio.get(v1.folio)).toMatchObject({
      clienteNombre: 'Venta de mostrador',
      esMostrador: true,
      totalCentavos: PRECIO,
      saldoCentavos: 0,
      estado: 'liquidado',
    });
    expect(porFolio.get(v2.folio)).toMatchObject({
      clienteNombre: 'Gloria',
      esMostrador: false,
      saldoCentavos: PRECIO - 4000,
      estado: 'abierto',
    });
    expect(porFolio.get(normal.folio)).toMatchObject({ esMostrador: false, saldoCentavos: PRECIO });
  });

  it('exhibidoresPorEntregar: solo con dinero pendiente, el mayor primero', async () => {
    const otroId = await app((db) =>
      crearExhibidor(db, { vendedorId: perlaId, nombre: 'Café Ana', fechaEnvio: '2026-10-01' }),
    );
    await enExhibidor(luzId, 'LZ01');
    await enExhibidor(solId, 'SL01', 'SL02');
    await venta(luzId, ['LZ01']);
    await venta(solId, ['SL01', 'SL02'], { cobrado: 20000 });
    expect(await app((db) => exhibidoresPorEntregar(db))).toEqual([
      { id: solId, nombre: 'Boutique Sol', vendedorNombre: 'Perla', porEntregarCentavos: 20000 },
      { id: luzId, nombre: 'Estética Luz', vendedorNombre: 'Perla', porEntregarCentavos: 10000 },
    ]);
    await app((db) =>
      registrarEntregaExhibidor(db, {
        key: randomUUID(),
        adminId,
        exhibidorId: luzId,
        montoCentavos: 10000,
        metodo: 'efectivo',
      }),
    );
    const r = await app((db) => exhibidoresPorEntregar(db));
    expect(r.map((x) => x.id)).toEqual([solId]);
    expect(r.map((x) => x.id)).not.toContain(otroId);
  });
});
