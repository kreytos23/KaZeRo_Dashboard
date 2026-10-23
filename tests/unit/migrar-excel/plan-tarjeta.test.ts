import { describe, expect, it } from 'vitest';
import {
  asignarTarjeta,
  type CeldaHoja,
  type PedidoTarjeta,
} from '../../../scripts/migrar-excel/plan-tarjeta';
import { siguientePosicion } from '../../../src/domain/lealtad';

const ped = (
  id: string,
  fecha: string,
  tipo: PedidoTarjeta['tipo'] = 'historico',
  estado: PedidoTarjeta['estado'] = 'liquidado',
): PedidoTarjeta => ({ id, fecha, estado, tipo });
const d = (fecha: string): CeldaHoja => ({ fecha });

describe('asignarTarjeta', () => {
  it('M-40 casa por la evidencia de la columna y luego por fecha a ±3 días', () => {
    const r = asignarTarjeta({
      pedidos: [ped('a', '2026-02-01'), ped('b', '2026-03-10'), ped('c', '2026-04-01')],
      filasHoja: [[d('2026-02-02'), d('2026-03-10'), d('2026-04-20')]],
      evidencia: new Map([['c', { posicion: 3, fecha: '2026-04-19' }]]),
    });
    expect(r.asignados.get('a')).toEqual({ ciclo: 1, posicion: 1 });
    expect(r.asignados.get('b')).toEqual({ ciclo: 1, posicion: 2 });
    expect(r.asignados.get('c')).toEqual({ ciclo: 1, posicion: 3 }); // la fecha del pedido no coincide, la evidencia sí
    expect(r.marcadores).toEqual([]);
    expect(r.sinTarjeta).toEqual([]);
  });

  it('M-40 una evidencia con fecha lejana solo casa si no hay otra opción de esa posición', () => {
    const r = asignarTarjeta({
      pedidos: [ped('a', '2026-02-01'), ped('b', '2026-06-01')],
      filasHoja: [[d('2026-02-01'), d('2026-06-02')]],
      evidencia: new Map([['b', { posicion: 1, fecha: '2026-06-01' }]]),
    });
    expect(r.asignados.get('a')).toEqual({ ciclo: 1, posicion: 1 });
    expect(r.asignados.get('b')).toEqual({ ciclo: 1, posicion: 2 });
  });

  it('M-41 "TBD" casa con un pedido abierto', () => {
    const r = asignarTarjeta({
      pedidos: [ped('a', '2026-02-01', 'kzr', 'abierto'), ped('b', '2026-02-05', 'historico', 'liquidado')],
      filasHoja: [[d('2026-02-05'), { fecha: null, tbd: true }]],
      evidencia: new Map(),
    });
    expect(r.asignados.get('b')).toEqual({ ciclo: 1, posicion: 1 });
    expect(r.asignados.get('a')).toEqual({ ciclo: 1, posicion: 2 });
    expect(r.marcadores).toEqual([]);
  });

  it('M-42 un hueco de la hoja es un marcador; la siguiente nota de la app queda en la posición correcta', () => {
    const r = asignarTarjeta({
      pedidos: [ped('p1', '2026-01-10'), ped('p2', '2026-03-02')],
      filasHoja: [[d('2026-01-10'), null, d('2026-03-02')]],
      evidencia: new Map(),
    });
    expect(r.asignados.get('p1')).toEqual({ ciclo: 1, posicion: 1 });
    expect(r.asignados.get('p2')).toEqual({ ciclo: 1, posicion: 3 });
    expect(r.marcadores).toEqual([{ ciclo: 1, posicion: 2, fecha: '2026-01-10' }]);
    expect(
      siguientePosicion([
        { ciclo: 1, posicion: 1 },
        { ciclo: 1, posicion: 2 },
        { ciclo: 1, posicion: 3 },
      ]),
    ).toEqual({ ciclo: 1, posicion: 4 });
  });

  it('M-43 una celda llena sin pedido identificable es un marcador con su fecha', () => {
    const r = asignarTarjeta({
      pedidos: [],
      filasHoja: [[d('2025-12-01'), { fecha: null }]],
      evidencia: new Map(),
    });
    expect(r.marcadores).toEqual([
      { ciclo: 1, posicion: 1, fecha: '2025-12-01' },
      { ciclo: 1, posicion: 2, fecha: '2025-12-01' },
    ]);
  });

  it('M-44 una nota KZR sin casar toma las siguientes posiciones y abre ciclo nuevo tras la 10', () => {
    const llena: CeldaHoja[] = Array.from({ length: 10 }, (_, i) => d(`2025-0${(i % 9) + 1}-15`));
    const r = asignarTarjeta({
      pedidos: [ped('k1', '2026-09-01', 'kzr', 'abierto'), ped('k2', '2026-09-20', 'kzr', 'abierto')],
      filasHoja: [llena],
      evidencia: new Map(),
    });
    expect(r.asignados.get('k1')).toEqual({ ciclo: 2, posicion: 1 });
    expect(r.asignados.get('k2')).toEqual({ ciclo: 2, posicion: 2 });
    expect(r.marcadores).toHaveLength(10);
  });

  it('M-45 un pedido histórico sin casar no cuenta para la tarjeta', () => {
    const r = asignarTarjeta({
      pedidos: [ped('h1', '2025-05-05'), ped('inv', '2026-10-03', 'inventario', 'abierto')],
      filasHoja: [],
      evidencia: new Map(),
    });
    expect(r.sinTarjeta.sort()).toEqual(['h1', 'inv']);
    expect(r.asignados.size).toBe(0);
  });

  it('M-46 las filas repetidas de la hoja son ciclos', () => {
    const r = asignarTarjeta({
      pedidos: [ped('a', '2025-01-10'), ped('b', '2026-05-05')],
      filasHoja: [[d('2025-01-10')], [d('2026-05-05')]],
      evidencia: new Map(),
    });
    expect(r.asignados.get('a')).toEqual({ ciclo: 1, posicion: 1 });
    expect(r.asignados.get('b')).toEqual({ ciclo: 2, posicion: 1 });
  });

  it('M-46 invariante: nunca dos en la misma (ciclo, posición) en 200 clientes sintéticos', () => {
    let semilla = 20261022;
    const azar = () => {
      semilla = (semilla + 0x6d2b79f5) | 0;
      let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const entero = (n: number) => Math.floor(azar() * n);
    const dia = () => new Date(Date.UTC(2025, 0, 1 + entero(500))).toISOString().slice(0, 10);
    for (let cliente = 0; cliente < 200; cliente++) {
      const ciclos = entero(4);
      const filasHoja: CeldaHoja[][] = Array.from({ length: ciclos }, () =>
        Array.from({ length: 10 }, () => {
          const x = azar();
          return x < 0.35
            ? null
            : x < 0.85
              ? { fecha: dia() }
              : x < 0.92
                ? { fecha: null, tbd: true }
                : { fecha: null };
        }),
      );
      const pedidos: PedidoTarjeta[] = Array.from({ length: entero(14) }, (_, i) =>
        ped(
          `c${cliente}p${i}`,
          dia(),
          (['kzr', 'historico', 'inventario'] as const)[entero(3)],
          azar() < 0.3 ? 'abierto' : 'liquidado',
        ),
      );
      const evidencia = new Map(
        pedidos
          .filter(() => azar() < 0.4)
          .map((p) => [p.id, { posicion: 1 + entero(10), fecha: azar() < 0.5 ? dia() : null }]),
      );
      const r = asignarTarjeta({ pedidos, filasHoja, evidencia });
      const usadas = new Set<string>();
      for (const pos of [...r.asignados.values(), ...r.marcadores]) {
        expect(pos.ciclo).toBeGreaterThanOrEqual(1);
        expect(pos.posicion).toBeGreaterThanOrEqual(1);
        expect(pos.posicion).toBeLessThanOrEqual(10);
        const k = `${pos.ciclo}:${pos.posicion}`;
        expect(usadas.has(k)).toBe(false);
        usadas.add(k);
      }
      // Cada pedido está exactamente en uno de los dos grupos y las notas KZR siempre tienen posición.
      for (const p of pedidos) {
        const a = r.asignados.has(p.id);
        const s = r.sinTarjeta.includes(p.id);
        expect(a !== s).toBe(true);
        if (p.tipo === 'kzr') expect(a).toBe(true);
      }
      // Toda celda llena de la hoja quedó cubierta por un pedido o un marcador.
      filasHoja.forEach((fila, k) =>
        fila.forEach((celda, i) => {
          if (celda) expect(usadas.has(`${k + 1}:${i + 1}`)).toBe(true);
        }),
      );
    }
  });
});
