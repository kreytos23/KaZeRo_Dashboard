import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { vPedido } from '@/db/schema';
import { numericACentavos } from '@/domain/dinero';
import { crearCliente } from '@/server/clientes/servicio';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { reporteDeudores } from '@/server/reportes/deudores';
import { resumenDeVendedora } from '@/server/vendedores/resumen';
import { cerrarMesComisiones } from '@/server/comisiones/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let perlaId = '';
let rosaId = '';
let conTel = '';
let sinTel = '';
let n = 0;

async function pedido(vendedorId: string, clienteId: string, precioCentavos: number, abonoCentavos = 0) {
  const codigo = `DU${String(++n).padStart(3, '0')}`;
  await app((db) =>
    altaPieza(db, { codigo, categoria: 'Aretes', descripcion: codigo, costoCentavos: 0, precioCentavos }),
  );
  const p = await app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      clienteId,
      vendedorId,
      cuentaTarjeta: false,
      descuentoManualCentavos: 0,
      codigos: [codigo],
    }),
  );
  if (abonoCentavos)
    await app((db) =>
      registrarPagoDePedido(db, {
        key: randomUUID(),
        adminId,
        pedidoId: p.id,
        montoCentavos: abonoCentavos,
        metodo: 'efectivo',
        pagador: 'cliente',
      }),
    );
  return p.id;
}
const fila = async (id: string) =>
  (await app((db) => db.select().from(vPedido).where(eq(vPedido.id, id))))[0]!;
const sumarDias = (iso: string, d: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  n = 0;
  perlaId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla', tipo: 'revendedora', comisionPct: '18.00' }),
  );
  rosaId = await app((db) =>
    crearVendedor(db, { nombre: 'Rosa', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  conTel = await app((db) => crearCliente(db, { nombre: 'Clienta', telefono: '5512345678' }));
  sinTel = await app((db) => crearCliente(db, { nombre: 'Lupe' }));
});

describe('reporteDeudores', () => {
  it('solo pedidos abiertos con saldo, con montos de v_pedido, teléfono nulo y días/atrasado', async () => {
    const a = await pedido(perlaId, conTel, 100000, 40000);
    const b = await pedido(perlaId, sinTel, 50000);
    const r1 = await pedido(rosaId, conTel, 30000);
    const liquidado = await pedido(perlaId, conTel, 20000, 20000);
    const cancelado = await pedido(rosaId, sinTel, 20000);
    const { version } = await fila(cancelado);
    await app((db) =>
      cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: cancelado, version, motivo: 'x' }),
    );
    const fa = await fila(a);

    const hoy = sumarDias(fa.fecha, 31);
    const r = await app((db) => reporteDeudores(db, { hoy }));
    expect(r.fecha).toBe(hoy);
    expect(r.numPedidos).toBe(3);
    expect(r.totalCentavos).toBe(60000 + 50000 + 30000);
    const ids = r.grupos.flatMap((g) => g.pedidos.map((p) => p.pedidoId));
    expect(ids.sort()).toEqual([a, b, r1].sort());
    expect(ids).not.toContain(liquidado);
    expect(r.grupos.map((g) => g.vendedorNombre)).toEqual(['Perla', 'Rosa']);
    const pa = r.grupos[0]!.pedidos.find((p) => p.pedidoId === a)!;
    expect(pa).toMatchObject({
      folio: fa.folio,
      clienteNombre: 'Clienta',
      telefono: '5512345678',
      totalCentavos: numericACentavos(fa.total),
      pagadoCentavos: numericACentavos(fa.pagado),
      saldoCentavos: numericACentavos(fa.saldo),
      dias: 31,
      atrasado: true,
    });
    expect(r.grupos[0]!.pedidos.find((p) => p.pedidoId === b)!.telefono).toBeNull();
    const hoyMismo = await app((db) => reporteDeudores(db, { hoy: fa.fecha }));
    expect(hoyMismo.grupos[0]!.pedidos.every((p) => p.dias === 0 && !p.atrasado)).toBe(true);
  });

  it('filtra por vendedora', async () => {
    await pedido(perlaId, conTel, 100000);
    const r1 = await pedido(rosaId, conTel, 30000);
    const r = await app((db) => reporteDeudores(db, { vendedorId: rosaId }));
    expect(r.numPedidos).toBe(1);
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0]!.pedidos[0]!.pedidoId).toBe(r1);
    expect(r.totalCentavos).toBe(30000);
  });

  it('sin deudas devuelve vacío', async () => {
    const r = await app((db) => reporteDeudores(db));
    expect(r).toMatchObject({ grupos: [], totalCentavos: 0, numPedidos: 0 });
  });
});

describe('resumenDeVendedora', () => {
  it('suma por cobrar, comisión estimada del mes abierto y pendientes de pago', async () => {
    await pedido(perlaId, conTel, 100000, 40000);
    await pedido(perlaId, sinTel, 50000);
    await pedido(rosaId, sinTel, 70000);
    await pedido(perlaId, conTel, 20000, 20000); // liquidado hoy: comisión 18% = 3600
    const hoy = await app(async (db) => (await db.select().from(vPedido).limit(1))[0]!.fecha);

    const r = await app((db) => resumenDeVendedora(db, perlaId, hoy));
    expect(r.porCobrarCentavos).toBe(60000 + 50000);
    expect(r.pedidosConSaldo).toBe(2);
    expect(r.comisionEnCurso.montoCentavos).toBe(3600);
    expect(r.comisionEnCurso.mes).toMatch(/^\d{4}-\d{2}-01$/);
    expect(r.pendientes).toEqual([]);

    // Cierra el mes en curso (hoy en el mes siguiente): queda pendiente de pago.
    const mesSig = sumarDias(r.comisionEnCurso.mes, 32).slice(0, 7) + '-01';
    await app((db) =>
      cerrarMesComisiones(db, { key: randomUUID(), adminId, mes: r.comisionEnCurso.mes, hoy: mesSig }),
    );
    const despues = await app((db) => resumenDeVendedora(db, perlaId, mesSig));
    expect(despues.pendientes).toMatchObject([{ mes: r.comisionEnCurso.mes, montoCentavos: 3600 }]);
    expect(despues.comisionEnCurso.montoCentavos).toBe(0);
    const rosa = await app((db) => resumenDeVendedora(db, rosaId, mesSig));
    expect(rosa.porCobrarCentavos).toBe(70000);
    expect(rosa.pendientes).toEqual([]);
  });
});
