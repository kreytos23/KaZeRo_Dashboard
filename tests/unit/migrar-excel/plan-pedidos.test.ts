import { describe, expect, it } from 'vitest';
import { leerLibros } from '../../../scripts/migrar-excel/leer';
import { planPedidos } from '../../../scripts/migrar-excel/plan-pedidos';
import { planPersonas } from '../../../scripts/migrar-excel/plan-personas';
import { planCatalogosYPiezas } from '../../../scripts/migrar-excel/plan-piezas';
import { nuevoContexto } from '../../../scripts/migrar-excel/tipos';
import {
  fecha,
  filaConc,
  filaInv,
  librosSinteticos,
  type DatosSinteticos,
} from '../../apoyo/libro-sintetico';
import { mapeoSintetico } from '../../apoyo/mapeo-sintetico';

async function planear(d: DatosSinteticos, extra: Record<string, unknown> = {}) {
  const b = await librosSinteticos(d);
  const l = await leerLibros({ ...b, hojasExhibidor: [] });
  const ctx = nuevoContexto();
  const m = mapeoSintetico(extra);
  const personas = planPersonas(l, m, ctx);
  const cat = planCatalogosYPiezas(l, m, ctx);
  const r = planPedidos(l, m, ctx, personas, cat);
  return { r, ctx, personas, cat, l, m };
}
type Datos = Partial<Parameters<typeof filaConc>[0]>;
const venta = (id: string, extra: Datos = {}) =>
  filaConc({
    f: fecha(2026, 9, 1),
    costo: 40,
    venta: 100,
    cliente: 'Clienta Uno',
    estatus: 'Vendido',
    id,
    desc: `Anillo ${id}`,
    coment: '05sep. vende',
    ...extra,
  });
const pagosDe = (r: Awaited<ReturnType<typeof planear>>['r'], folio: number) => {
  const p = r.pedidos.find((x) => x.folio === folio)!;
  return r.pagos.filter((x) => x.pedidoId === p.id);
};

describe('planPedidos', () => {
  it('M-30 Nota KZR: sus filas son las líneas; todas vendidas → liquidada con pago = total', async () => {
    const { r } = await planear({
      concentrado: [venta('AB01', { nota: 'KZR-7' }), venta('AB02', { nota: 'KZR-7', venta: 250.5 })],
    });
    expect(r.pedidos).toHaveLength(1);
    expect(r.pedidos[0]).toMatchObject({
      folio: 7,
      folioOriginal: 7,
      tipo: 'kzr',
      estado: 'liquidado',
      total: 35050,
      fecha: '2026-09-05',
      descuentoManual: 0,
      descuentoManualMotivo: null,
      liquidadoEn: '2026-09-05T12:00:00-06:00',
    });
    expect(r.pedidos[0]!.items.map((i) => [i.precioLista, i.precioFinal])).toEqual([
      [10000, 10000],
      [25050, 25050],
    ]);
    expect(r.pagos).toEqual([expect.objectContaining({ monto: 35050, fecha: '2026-09-05' })]);
    expect(r.pedidos[0]!.notas).toMatch(/^Excel \(filas 3, 4\): /);
  });

  it('M-30 una línea por cobrar → abierta con pago = lo vendido; "KZR - 8" es el folio 8', async () => {
    const { r } = await planear({
      concentrado: [
        venta('AB01', { nota: 'KZR - 8' }),
        venta('AB02', { nota: 'KZR - 8', estatus: 'Por cobrar', venta: 300 }),
      ],
    });
    expect(r.pedidos[0]).toMatchObject({ folio: 8, estado: 'abierto', total: 40000, liquidadoEn: null });
    expect(pagosDe(r, 8).map((p) => p.monto)).toEqual([10000]);
  });

  it('M-30 una fecha en la columna de nota → fila sin nota + aviso; una nota con 2 clientes se rechaza completa', async () => {
    const { r, ctx } = await planear({
      concentrado: [
        venta('AB01', { nota: fecha(2026, 9, 2) }),
        venta('AB02', { nota: 'KZR-9', cliente: 'Clienta Uno' }),
        venta('AB03', { nota: 'KZR-9', cliente: 'Clienta Dos' }),
      ],
    });
    expect(r.pedidos.map((p) => [p.tipo, p.folio])).toEqual([['historico', 100001]]);
    expect(ctx.avisos.some((a) => a.tipo === 'nota_con_fecha')).toBe(true);
    expect(ctx.rechazos.filter((x) => x.motivo === 'nota con dos clientes').map((x) => x.fila)).toEqual([
      4, 5,
    ]);
    expect(r.piezas.map((p) => p.codigo)).toEqual(['H-AB01']); // las piezas de la nota rechazada no entran
  });

  it('M-31 sin nota: agrupa por cliente, vendedor y fecha; folios 100001 en orden; barajar no cambia nada', async () => {
    const filas = [
      venta('AB01', { cliente: 'Vend A - Clienta Uno', tarjeta: '1 5/9/26' }),
      venta('AB02', { cliente: 'Vend A - Clienta Uno', tarjeta: '2 5/9/26' }),
      venta('AB03', { cliente: 'Clienta Uno', tarjeta: '3 5/9/26' }),
      venta('AB04', { cliente: 'Clienta Dos', tarjeta: '1 2/9/26' }),
    ];
    const resumen = async (f: typeof filas) => {
      const { r, personas } = await planear({ concentrado: f });
      const nombre = (id: string) => personas.clientes.find((c) => c.id === id)!.nombre;
      return r.pedidos
        .map(
          (p) =>
            `${p.folio}|${nombre(p.clienteId)}|${p.vendedorId.slice(0, 4)}|${p.fecha}|${p.items.length}|${p.total}`,
        )
        .sort();
    };
    const a = await resumen(filas);
    expect(a).toHaveLength(3);
    expect(a.map((x) => x.split('|')[0])).toEqual(['100001', '100002', '100003']);
    expect(a[0]).toContain('Clienta Dos|');
    expect(await resumen([...filas].reverse())).toEqual(a);
  });

  it('M-32 por cobrar con RESTA n → saldo n; sin RESTA → sin pago; nunca más pago que total', async () => {
    const { r } = await planear({
      concentrado: [
        venta('AB01', {
          estatus: 'Por cobrar',
          coment: '05sep. aparta / abona, RESTA 30',
          cliente: 'Clienta Uno',
        }),
        venta('AB02', { estatus: 'Por cobrar', coment: '06sep. aparta', cliente: 'Clienta Dos' }),
        venta('AB03', { estatus: 'Por cobrar', venta: 0, cliente: 'Clienta Tres' }),
        venta('AB04', { estatus: 'Por cobrar', coment: '07sep. RESTA 900', cliente: 'Clienta Cuatro' }),
      ],
    });
    const por = (n: number) => r.pedidos.find((p) => p.items[0]!.piezaId === r.piezas[n]!.id)!;
    const pagado = (p: { id: string }) =>
      r.pagos.filter((x) => x.pedidoId === p.id).reduce((a, x) => a + x.monto, 0);
    expect(por(0)).toMatchObject({ estado: 'abierto', total: 10000 });
    expect(pagado(por(0))).toBe(7000);
    expect(pagado(por(1))).toBe(0);
    expect(por(1).estado).toBe('abierto');
    expect(por(2)).toMatchObject({ estado: 'liquidado', total: 0 });
    expect(pagado(por(2))).toBe(0);
    expect(pagado(por(3))).toBe(0); // RESTA mayor que el precio: el pago no puede ser negativo
    for (const p of r.pedidos) expect(pagado(p)).toBeLessThanOrEqual(p.total);
  });

  it('M-33 no se cobró → liquidado en 0 con descuento manual igual al subtotal; no cuenta para la tarjeta', async () => {
    const { r } = await planear({ concentrado: [venta('AB01', { estatus: 'No se cobró' })] });
    expect(r.pedidos[0]).toMatchObject({
      estado: 'liquidado',
      total: 0,
      descuentoManual: 10000,
      descuentoManualMotivo: 'No se cobró (Excel)',
      cuentaTarjeta: false,
    });
    expect(r.pedidos[0]!.items[0]).toMatchObject({ precioLista: 10000, precioFinal: 10000 });
    expect(r.pagos).toEqual([]);
    expect(r.piezas[0]!.estado).toBe('vendida');
  });

  it('M-34 regalo con cliente → pedido en 0 sin tarjeta; rifa o regalo sin cliente → pieza regalo sin pedido', async () => {
    const { r } = await planear({
      concentrado: [
        venta('AB01', { estatus: 'Regalo', venta: 0 }),
        venta('AB02', { estatus: 'Regalo', venta: 80, cliente: 'Clienta Dos' }),
        venta('AB03', { estatus: 'Regalo', cliente: null }),
        venta('AB04', { estatus: 'Rifa', cliente: 'Clienta Tres' }),
      ],
    });
    expect(r.pedidos).toHaveLength(2);
    expect(r.pedidos.every((p) => p.total === 0 && !p.cuentaTarjeta && p.estado === 'liquidado')).toBe(true);
    expect(r.pedidos.map((p) => p.descuentoManualMotivo).sort()).toEqual(['Regalo (Excel)', null]);
    expect(r.piezas.map((p) => [p.codigo, p.estado])).toEqual([
      ['H-AB01', 'vendida'],
      ['H-AB02', 'vendida'],
      ['H-AB03', 'regalo'],
      ['H-AB04', 'regalo'],
    ]);
  });

  it('M-35 sin cliente → cliente genérico y sin tarjeta', async () => {
    const { r, personas } = await planear({ concentrado: [venta('AB01', { cliente: null })] });
    const g = personas.clientes.find((c) => c.nombre === 'Sin cliente (histórico)')!;
    expect(r.pedidos[0]).toMatchObject({ clienteId: g.id, cuentaTarjeta: false });
    expect(r.elegibles.size).toBe(0);
  });

  it('M-36 pieza del inventario con cliente y sin venta → pedido abierto "inventario" + aviso', async () => {
    const { r, ctx, personas } = await planear({
      inventario: [
        filaInv({
          id: 'ZZ01',
          cliente: 'Clienta Uno',
          vend: 'Vend A',
          precio: 150,
          ubic: 'Exhibidor A - 16sep',
        }),
        filaInv({ id: 'ZZ02', cliente: 'Clienta Uno', vend: 'Vend A', precio: 200 }),
        filaInv({ id: 'ZZ03', cliente: 'Clienta Uno', vend: 'Vend A', precio: null }),
      ],
    });
    expect(r.pedidos).toHaveLength(1);
    expect(r.pedidos[0]).toMatchObject({
      tipo: 'inventario',
      estado: 'abierto',
      total: 35000,
      fecha: '2026-10-03',
      cuentaTarjeta: false,
      vendedorId: personas.vendedores.find((v) => v.nombre === 'Vendedora A')!.id,
    });
    expect(r.pagos).toEqual([]);
    expect(ctx.avisos.filter((a) => a.tipo === 'inventario_con_cliente_sin_venta')).toHaveLength(2);
    expect(ctx.rechazos.map((x) => x.motivo)).toEqual(['pieza de inventario con cliente y sin precio']);
    const zz01 = r.piezas.find((p) => p.codigo === 'ZZ01')!;
    expect(zz01).toMatchObject({ estado: 'apartada', pedidoId: r.pedidos[0]!.id });
    expect(zz01.exhibidorId).not.toBeNull(); // conserva el exhibidor de origen
  });

  it('M-37 estado final de la pieza: liquidado → vendida sin exhibidor; abierto → apartada con su exhibidor', async () => {
    const { r } = await planear({
      inventario: [
        filaInv({ id: 'ZZ01', prod: 'Anillo uno', ubic: 'Exhibidor A - 16sep' }),
        filaInv({ id: 'ZZ02', prod: 'Anillo dos', ubic: 'Exhibidor A - 16sep' }),
      ],
      concentrado: [
        venta('ZZ01', { desc: 'Anillo uno', cliente: 'Clienta Uno' }),
        venta('ZZ02', { desc: 'Anillo dos', cliente: 'Clienta Dos', estatus: 'Por cobrar' }),
      ],
    });
    const pz = (c: string) => r.piezas.find((p) => p.codigo === c)!;
    expect(pz('ZZ01')).toMatchObject({ estado: 'vendida', exhibidorId: null });
    expect(pz('ZZ02')).toMatchObject({ estado: 'apartada' });
    expect(pz('ZZ02').exhibidorId).not.toBeNull();
    expect(pz('ZZ01').pedidoId).toBe(r.pedidos.find((p) => p.estado === 'liquidado')!.id);
    expect(pz('ZZ01').fechaMovimiento >= pz('ZZ01').fechaAlta).toBe(true);
  });

  it('M-37 una pieza en dos pedidos (R-05): la segunda línea se rechaza', async () => {
    const b = await librosSinteticos({
      concentrado: [venta('AB01', { cliente: 'Clienta Uno' }), venta('AB02', { cliente: 'Clienta Dos' })],
    });
    const l = await leerLibros({ ...b, hojasExhibidor: [] });
    const ctx = nuevoContexto();
    const m = mapeoSintetico();
    const personas = planPersonas(l, m, ctx);
    const cat = planCatalogosYPiezas(l, m, ctx);
    cat.vinculo.set(4, cat.vinculo.get(3)!); // dos filas, la misma pieza
    const r = planPedidos(l, m, ctx, personas, cat);
    expect(r.pedidos).toHaveLength(1);
    expect(ctx.rechazos.map((x) => [x.fila, x.motivo])).toContainEqual([4, 'pieza ya está en otro pedido']);
  });

  it('M-38 el pagador es el vendedor si no es la casa; si no, el cliente; el pago no es anterior al pedido', async () => {
    const { r, personas } = await planear({
      concentrado: [
        venta('AB01', { cliente: 'Vend A - Clienta Uno', coment: '05sep. vende' }),
        venta('AB02', { cliente: 'Clienta Dos', coment: '05sep. aparta / 20sep. transfiere' }),
        venta('AB03', { cliente: 'Clienta Tres', coment: '05sep. vende / 02sep. pago' }),
      ],
    });
    const vendA = personas.vendedores.find((v) => v.nombre === 'Vendedora A')!.id;
    const pagoDe = (n: number) => r.pagos.find((p) => p.pedidoId === r.pedidos[n]!.id)!;
    expect(pagoDe(0)).toMatchObject({ pagadorVendedorId: vendA, pagadorClienteId: null });
    expect(pagoDe(1)).toMatchObject({ pagadorVendedorId: null, fecha: '2026-09-20' });
    expect(pagoDe(1).pagadorClienteId).toBe(r.pedidos[1]!.clienteId);
    for (const p of r.pagos) {
      const ped = r.pedidos.find((x) => x.id === p.pedidoId)!;
      expect(p.fecha >= ped.fecha).toBe(true);
      expect(p.nota).toBe('Pago histórico resumido (Excel fase 1)');
      expect(p.idempotencyKey).toMatch(/^[0-9a-f]{8}-/);
    }
  });

  it('D-13 la fecha de venta sale de la columna Tarjeta, de los comentarios, de la compra o de la fila anterior', async () => {
    const { r, ctx } = await planear({
      concentrado: [
        venta('AB01', {
          f: fecha(2026, 1, 1),
          cliente: 'Clienta Uno',
          tarjeta: '1 10/3/26',
          coment: '05sep. x',
        }),
        venta('AB02', {
          f: fecha(2026, 1, 1),
          cliente: 'Clienta Dos',
          coment: '21may. aparta / 12jun. transfiere',
        }),
        venta('AB03', { f: fecha(2026, 2, 2), cliente: 'Clienta Tres', coment: null }),
        venta('AB04', { f: null, cliente: 'Clienta Cuatro', coment: null }),
      ],
    });
    expect(r.pedidos.map((p) => p.fecha)).toEqual(['2026-03-10', '2026-05-21', '2026-02-02', '2026-02-02']);
    expect(r.pagos.find((p) => p.pedidoId === r.pedidos[1]!.id)!.fecha).toBe('2026-06-12');
    expect(ctx.avisos.map((a) => a.tipo)).toEqual(
      expect.arrayContaining(['fecha_venta_inferida', 'fecha_venta_de_compra', 'fecha_venta_fila_anterior']),
    );
  });

  it('el vendedor del pedido: prefijo, luego Comisión, luego el del inventario, luego la casa', async () => {
    const { r, personas } = await planear({
      inventario: [filaInv({ id: 'ZZ03', prod: 'Anillo tres', vend: 'Vendedora B' })],
      concentrado: [
        venta('AB01', { cliente: 'Clienta Uno', com: '15% Vend A - sep' }),
        venta('AB02', { cliente: 'Clienta Dos' }),
        venta('ZZ03', { cliente: 'Clienta Tres', desc: 'Anillo tres' }),
      ],
    });
    const v = (n: string) => personas.vendedores.find((x) => x.nombre === n)!.id;
    expect(r.pedidos.map((p) => p.vendedorId)).toEqual([
      v('Vendedora A'),
      v('Casa Prueba'),
      v('Vendedora B'),
    ]);
  });
});
