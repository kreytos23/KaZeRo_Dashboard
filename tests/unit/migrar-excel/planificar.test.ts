import { describe, expect, it } from 'vitest';
import { leerLibros } from '../../../scripts/migrar-excel/leer';
import { planificar, validarInvariantes } from '../../../scripts/migrar-excel/planificar';
import {
  fecha,
  filaConc,
  filaInv,
  librosSinteticos,
  type DatosSinteticos,
} from '../../apoyo/libro-sintetico';
import { mapeoSintetico } from '../../apoyo/mapeo-sintetico';

const venta = (id: string, extra: Partial<Parameters<typeof filaConc>[0]> = {}) =>
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

async function libro(d: DatosSinteticos) {
  const b = await librosSinteticos(d);
  return leerLibros({ ...b, hojasExhibidor: [] });
}
const base: DatosSinteticos = {
  inventario: [
    filaInv({ id: 'ZZ01', prod: 'Anillo uno', ubic: 'Exhibidor A - 16sep' }),
    filaInv({ id: 'ZZ02', prod: 'Anillo dos', cliente: 'Clienta Tres', vend: 'Vend A' }),
    filaInv({ id: 'ZZ03', prod: 'Anillo tres' }),
  ],
  concentrado: [
    venta('ZZ01', { desc: 'Anillo uno', tarjeta: '1 5/9/26', cliente: 'Vend A - Clienta Uno' }),
    venta('AB02', { tarjeta: '3 20/9/26', coment: '20sep. vende' }),
    venta('AB03', {
      nota: 'KZR-5',
      cliente: 'Clienta Dos',
      estatus: 'Por cobrar',
      venta: 500,
      coment: '02sep. aparta / RESTA 120',
    }),
    venta('AB04', { estatus: 'No se cobró', cliente: 'Clienta Dos' }),
    venta('AB05', { estatus: 'Rifa', cliente: null }),
    venta('AB06', { cliente: null }),
  ],
  lealtad: [['Clienta Uno', fecha(2026, 9, 5), null, fecha(2026, 9, 20)]],
};

describe('planificar', () => {
  it('arma el plan completo, cumple los invariantes y la tarjeta queda con marcadores y posiciones', async () => {
    const { plan } = planificar(await libro(base), mapeoSintetico());
    expect(() => validarInvariantes(plan)).not.toThrow();
    const uno = plan.clientes.find((c) => c.nombre === 'Clienta Uno')!;
    const tarjeta = plan.pedidos
      .filter((p) => p.clienteId === uno.id && p.cuentaTarjeta)
      .map((p) => [p.ciclo, p.posicion, p.tipo, p.total])
      .sort();
    expect(tarjeta).toEqual([
      [1, 1, 'historico', 10000],
      [1, 2, 'posicion', 0],
      [1, 3, 'historico', 10000],
    ]);
    const marcador = plan.pedidos.find((p) => p.tipo === 'posicion')!;
    expect(marcador).toMatchObject({ estado: 'liquidado', total: 0, items: [], folio: expect.any(Number) });
    expect(marcador.notas).toBe('Posición de tarjeta migrada sin venta identificada (Excel)');
    // La nota KZR de otra clienta toma la posición 1 de su tarjeta; "no se cobró" y el genérico no cuentan.
    const dos = plan.clientes.find((c) => c.nombre === 'Clienta Dos')!;
    const pDos = plan.pedidos.filter((p) => p.clienteId === dos.id);
    expect(pDos.find((p) => p.folio === 5)).toMatchObject({
      cuentaTarjeta: true,
      ciclo: 1,
      posicion: 1,
      estado: 'abierto',
    });
    expect(pDos.find((p) => p.total === 0)!.cuentaTarjeta).toBe(false);
    expect(
      plan.pedidos.filter(
        (p) => p.clienteId === plan.clientes.find((c) => c.nombre === 'Sin cliente (histórico)')!.id,
      ),
    ).toHaveLength(1);
    // Pieza rifa sin pedido; exhibidor sin piezas no se crea; folios únicos.
    expect(plan.piezas.find((p) => p.codigo === 'H-AB05')).toMatchObject({
      estado: 'regalo',
      pedidoId: null,
    });
    expect(plan.exhibidores).toEqual([]);
    const folios = plan.pedidos.map((p) => p.folio);
    expect(new Set(folios).size).toBe(folios.length);
    expect(Math.min(...folios.filter((f) => f !== 5))).toBe(100001);
    // Conciliación: saldo de la nota KZR = 500 − 120 abonados… (RESTA 120 → pagado 380)
    expect(plan.conciliacion.saldoTotal).toBe(12000 + 15000); // KZR-5 (RESTA 120) + pedido abierto de inventario (150)
    expect(plan.conciliacion.conteos).toMatchObject({
      clientes: 4,
      vendedores: 3,
      pedidos: plan.pedidos.length,
    });
    expect(plan.conciliacion.porMes.reduce((a, x) => a + x.pedidos, 0)).toBe(plan.pedidos.length);
    expect(plan.conciliacion.tarjeta.filter((t) => t.clienteId === uno.id)).toHaveLength(3);
  });

  it('M-47 un plan que rompe una regla de la BD hace fallar validarInvariantes', async () => {
    const { plan } = planificar(await libro(base), mapeoSintetico());
    const copia = () => structuredClone(plan);
    const falla = (mutar: (p: typeof plan) => void, texto: RegExp) => {
      const p = copia();
      mutar(p);
      expect(() => validarInvariantes(p)).toThrow(texto);
    };
    falla((p) => void (p.piezas[1]!.id = p.piezas[0]!.id), /id repetido/);
    falla((p) => void (p.pedidos[0]!.total += 1), /total/);
    falla((p) => void (p.pagos[0]!.monto += 10_000_000), /pagos/);
    falla((p) => void (p.pedidos[0]!.items[0]!.precioFinal -= 1), /precio/);
    falla((p) => void (p.piezas[0]!.codigo = 'mal codigo'), /código/);
    falla((p) => void (p.pedidos[1]!.folio = p.pedidos[0]!.folio), /folio/);
    falla(
      (p) => void (p.pedidos.find((x) => x.estado === 'abierto')!.liquidadoEn = '2026-01-01T12:00:00-06:00'),
      /liquidad/,
    );
    falla((p) => void (p.pedidos.find((x) => !x.cuentaTarjeta)!.ciclo = 1), /tarjeta/);
    falla((p) => void (p.pedidos.find((x) => x.tipo === 'posicion')!.posicion = 1), /tarjeta/);
    falla(
      (p) => void (p.piezas.find((x) => x.estado === 'vendida')!.exhibidorId = p.exhibidores[0]?.id ?? 'x'),
      /exhibidor/,
    );
    falla(
      (p) => void (p.pedidos.find((x) => x.descuentoManual > 0)!.descuentoManualMotivo = null),
      /descuento/,
    );
    falla((p) => void (p.pedidos[0]!.notas = 'x'.repeat(501)), /notas/);
  });

  it('M-48 el hash es estable y cambia al cambiar un precio', async () => {
    // El mismo libro leído dos veces (un .xlsx recién armado trae su propia hora de creación).
    const l = await libro(base);
    const a = planificar(l, mapeoSintetico());
    const b = planificar(l, mapeoSintetico());
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    const cambiado = structuredClone(base);
    cambiado.concentrado![1]![2] = 101;
    expect(planificar(await libro(cambiado), mapeoSintetico()).hash).not.toBe(a.hash);
  });
});
