import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pedidoItem, vPedido } from '@/db/schema';
import { hoyMX } from '@/domain/fechas';
import { crearCliente } from '@/server/clientes/servicio';
import { registrarVentaExhibidor } from '@/server/exhibidores/dinero';
import { crearExhibidor, enviarPiezas } from '@/server/exhibidores/servicio';
import { anularPago } from '@/server/pagos/anular';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { devolverPiezaDefectuosa } from '@/server/pedidos/devolucion';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { reporteDeudores } from '@/server/reportes/deudores';
import { resumenDePeriodo } from '@/server/reportes/resumen';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

// Plan 5b, Task 6: lectura agregada del Resumen por periodo (reglas M-1..M-6).
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const hoy = hoyMX();
const DESDE = '2026-01-01';
const HASTA = '2026-01-31';
let adminId = '';
let vendedorId = '';
let clienteId = '';

const alta = (codigo: string, costoCentavos: number, precioCentavos = 10000, categoria = 'Aretes') =>
  app((db) =>
    altaPieza(db, { codigo, categoria, descripcion: `Pieza ${codigo}`, costoCentavos, precioCentavos }),
  );
const pedido = (
  codigos: string[],
  extra: { descuentoManualCentavos?: number; descuentoManualMotivo?: string; clienteId?: string } = {},
) =>
  app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      clienteId,
      vendedorId,
      codigos,
      fecha: '2026-01-10',
      cuentaTarjeta: false,
      descuentoManualCentavos: 0,
      ...extra,
    }),
  );
const pagar = (pedidoId: string, montoCentavos: number, metodo: 'efectivo' | 'saldo_favor' = 'efectivo') =>
  app((db) =>
    registrarPagoDePedido(db, {
      key: randomUUID(),
      adminId,
      pedidoId,
      montoCentavos,
      metodo,
      pagador: 'cliente',
      fecha: '2026-01-11',
      confirmarDuplicado: true,
    }),
  );
const resumen = () => app((db) => resumenDePeriodo(db, { desde: DESDE, hasta: HASTA, hoy }));

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  clienteId = await app((db) => crearCliente(db, { nombre: 'Clienta Sintética' }));
  vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla Ejemplo', tipo: 'revendedora', comisionPct: '10.00' }),
  );
});

describe('resumen del periodo', () => {
  it('M-1: una nota cancelada no cuenta; fuera del periodo tampoco', async () => {
    await alta('RS01', 4000);
    await alta('RS02', 4000);
    await pedido(['RS01']);
    const cancelada = await pedido(['RS02']);
    const [f] = await app((db) =>
      db.select({ version: vPedido.version }).from(vPedido).where(eq(vPedido.id, cancelada.id)),
    );
    await app((db) =>
      cancelarPedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: cancelada.id,
        version: f!.version,
        motivo: 'Ya no la quiere',
      }),
    );
    expect(await resumen()).toMatchObject({ ventasCentavos: 10000, notas: 1 });
    const fuera = await app((db) => resumenDePeriodo(db, { desde: '2026-02-01', hasta: '2026-02-28', hoy }));
    expect(fuera).toMatchObject({ ventasCentavos: 0, notas: 0, cobrosCentavos: 0 });
  });

  it('M-2: un pago deshecho no cuenta', async () => {
    await alta('RS03', 4000);
    await alta('RS04', 4000);
    const a = await pedido(['RS03']);
    const b = await pedido(['RS04']);
    await pagar(a.id, 3000);
    const deshecho = await pagar(b.id, 2000);
    await app((db) =>
      anularPago(db, { key: randomUUID(), adminId, pagoId: deshecho.pagoId, motivo: 'Rechazado' }),
    );
    expect((await resumen()).cobrosCentavos).toBe(3000);
  });

  it('M-3 y M-4: el descuento manual baja el margen; las piezas sin costo van al aviso', async () => {
    await alta('RS05', 4000, 10000);
    await alta('RS06', 0, 10000);
    await pedido(['RS05', 'RS06'], { descuentoManualCentavos: 2000, descuentoManualMotivo: 'Promoción' });
    expect(await resumen()).toMatchObject({
      ventasCentavos: 18000,
      margenCentavos: 5000,
      baseMargenCentavos: 9000,
      piezasSinCosto: 1,
    });
  });

  it('M-1, M-2 y M-4: una devolución resta de ventas y margen; el saldo a favor no es un cobro', async () => {
    await alta('RS07', 4000);
    await alta('RS08', 4000);
    await alta('RS15', 4000, 10000, 'Collares');
    // Subtotal 20000 y descuento manual 2000: se reparte 1000 a cada línea (iguales) y cada una queda en 9000.
    const p = await pedido(['RS07', 'RS08'], {
      descuentoManualCentavos: 2000,
      descuentoManualMotivo: 'Promoción',
    });
    await pagar(p.id, 18000);
    const [linea] = await app((db) =>
      db.select({ id: pedidoItem.id }).from(pedidoItem).where(eq(pedidoItem.pedidoId, p.id)).limit(1),
    );
    await app((db) =>
      devolverPiezaDefectuosa(db, {
        key: randomUUID(),
        adminId,
        pedidoId: p.id,
        itemId: linea!.id,
        motivo: 'Se rompió el broche',
      }),
    );
    // Ventas: 18000 - 9000 devuelto = 9000. Margen: línea que queda 9000 - 4000 = 5000 (importe ya repartido).
    // Cobros: solo los 18000 en efectivo. Categorías: Aretes 9000 (la devuelta no cuenta).
    expect(await resumen()).toMatchObject({
      ventasCentavos: 9000,
      margenCentavos: 5000,
      baseMargenCentavos: 9000,
      cobrosCentavos: 18000,
      topCategorias: [{ nombre: 'Aretes', centavos: 9000 }],
    });
    // La devolución dejó 9000 a favor de la clienta: una nota nueva se paga 5000 con ese saldo.
    const nueva = await pedido(['RS15']);
    await pagar(nueva.id, 5000, 'saldo_favor');
    // Ventas: 9000 + 10000 = 19000. Margen: 5000 + (10000 - 4000) = 11000. Base: 9000 + 10000 = 19000.
    // Notas: 2. Categorías: Collares 10000 y Aretes 9000. Top (misma clienta y vendedora): 19000.
    // Cobros: igual que antes, 18000: los 5000 de saldo a favor no son dinero nuevo (M-2).
    const r = await resumen();
    expect(r).toMatchObject({
      ventasCentavos: 19000,
      notas: 2,
      margenCentavos: 11000,
      baseMargenCentavos: 19000,
      cobrosCentavos: 18000,
    });
    expect(r.topCategorias).toEqual([
      { nombre: 'Collares', centavos: 10000 },
      { nombre: 'Aretes', centavos: 9000 },
    ]);
    expect(r.topClientas).toEqual([{ id: clienteId, nombre: 'Clienta Sintética', centavos: 19000 }]);
    expect(r.topVendedoras).toEqual([{ id: vendedorId, nombre: 'Perla Ejemplo', centavos: 19000 }]);
  });

  it('I-1: descuento impar y devolución de la segunda línea: categorías y margen cuadran con las ventas', async () => {
    await alta('RS16', 4000, 10000);
    await alta('RS17', 4000, 10000);
    // Subtotal 20000, descuento manual 1001 (impar). Reparto por residuo mayor en orden de id: 1001·10000/20000 =
    // 500,5 → 500 a cada línea, sobra 1 centavo y el empate va a la primera: cuotas [501, 500], importes
    // [9499, 9500]. Total de la nota: 20000 − 1001 = 18999.
    const p = await pedido(['RS16', 'RS17'], {
      descuentoManualCentavos: 1001,
      descuentoManualMotivo: 'Promoción',
    });
    await pagar(p.id, 18999);
    const lineas = await app((db) =>
      db
        .select({ id: pedidoItem.id })
        .from(pedidoItem)
        .where(eq(pedidoItem.pedidoId, p.id))
        .orderBy(asc(pedidoItem.id)),
    );
    await app((db) =>
      devolverPiezaDefectuosa(db, {
        key: randomUUID(),
        adminId,
        pedidoId: p.id,
        itemId: lineas[1]!.id,
        motivo: 'Se rompió el broche',
      }),
    );
    // Devolución de la segunda: 9500. Ventas: 18999 − 9500 = 9499. Queda la primera: Aretes 9499, margen
    // 9499 − 4000 = 5499 sobre base 9499. Si el Resumen repartiera en otro orden, Aretes saldría en 9500.
    const r = await resumen();
    expect(r).toMatchObject({ ventasCentavos: 9499, margenCentavos: 5499, baseMargenCentavos: 9499 });
    expect(r.topCategorias).toEqual([{ nombre: 'Aretes', centavos: 9499 }]);
    expect(r.topCategorias.reduce((a, c) => a + c.centavos, 0)).toBe(r.ventasCentavos);
  });

  it('M-5: la venta de mostrador no entra en el top de clientas', async () => {
    await alta('RS09', 4000);
    await alta('RS13', 4000);
    await pedido(['RS09']);
    // `crearPedido` no admite la clienta de mostrador: esa nota solo nace de una venta del exhibidor.
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId, nombre: 'Salón Mostrador', fechaEnvio: '2026-01-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['RS13'] }));
    await app((db) =>
      registrarVentaExhibidor(db, {
        key: randomUUID(),
        adminId,
        exhibidorId,
        codigos: ['RS13'],
        clienteId: null,
        fecha: '2026-01-10',
        cobradoCentavos: 5000,
        metodo: 'efectivo',
      }),
    );
    const r = await resumen();
    expect(r.notas).toBe(2);
    // M-2: lo que cobra un exhibidor cuenta como cobro aunque la pieza aún no se haya entregado.
    expect(r.cobrosCentavos).toBe(5000);
    expect(r.topClientas).toEqual([{ id: clienteId, nombre: 'Clienta Sintética', centavos: 10000 }]);
    expect(r.topVendedoras).toEqual([{ id: vendedorId, nombre: 'Perla Ejemplo', centavos: 20000 }]);
    expect(r.topCategorias).toEqual([{ nombre: 'Aretes', centavos: 20000 }]);
  });

  it('M-6: por cobrar = deudores; ubicaciones sin vendidas, con exhibidor y Kazero', async () => {
    await alta('RS10', 4000);
    await alta('RS11', 4000);
    await alta('RS12', 4000);
    await alta('RS14', 4000);
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId, nombre: 'Salón Prueba', fechaEnvio: '2026-01-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['RS11'] }));
    const p = await pedido(['RS12']);
    await pagar(p.id, 10000);
    // Una nota abierta con saldo: el «por cobrar» no puede salir en cero por casualidad.
    await pedido(['RS14']);
    const r = await resumen();
    const deudores = await app((db) => reporteDeudores(db, { hoy }));
    expect(deudores.totalCentavos).toBe(10000);
    expect(r.porCobrarCentavos).toBe(deudores.totalCentavos);
    expect(r.ubicaciones).toEqual([
      { etiqueta: 'Exhibidor Salón Prueba', piezas: 1 },
      { etiqueta: 'Kazero', piezas: 2 },
    ]);
  });
});
