import { describe, expect, it } from 'vitest';
import { agruparDeudores, type PedidoDeudor } from '@/domain/deudores';

const p = (o: Partial<PedidoDeudor>): PedidoDeudor => ({
  pedidoId: 'p', folio: 1, vendedorId: 'v1', vendedorNombre: 'Ana', clienteNombre: 'Cli', telefono: null,
  fecha: '2026-11-01', totalCentavos: 1000, pagadoCentavos: 0, saldoCentavos: 1000, ...o,
});

describe('agruparDeudores', () => {
  const hoy = '2026-12-01';
  const r = agruparDeudores(
    [
      p({ pedidoId: 'a', folio: 5, fecha: '2026-11-01', saldoCentavos: 500 }),
      p({ pedidoId: 'b', folio: 3, fecha: '2026-11-02', saldoCentavos: 300 }),
      p({ pedidoId: 'c', folio: 4, fecha: '2026-11-01', saldoCentavos: 200 }),
      p({ pedidoId: 'd', folio: 6, vendedorId: 'v2', vendedorNombre: 'Zoila', saldoCentavos: 2000 }),
      p({ pedidoId: 'e', folio: 7, saldoCentavos: 0 }),
    ],
    hoy,
  );
  it('ordena grupos por saldo desc y pedidos por fecha y folio asc', () => {
    expect(r.grupos.map((g) => g.vendedorId)).toEqual(['v2', 'v1']);
    expect(r.grupos[1]!.pedidos.map((x) => x.pedidoId)).toEqual(['c', 'a', 'b']);
  });
  it('ignora saldo cero y totaliza', () => {
    expect(r.numPedidos).toBe(4);
    expect(r.totalCentavos).toBe(3000);
    expect(r.grupos[1]!.saldoCentavos).toBe(1000);
  });
  it('días de antigüedad y atraso (más de 30)', () => {
    const f = (fecha: string) => agruparDeudores([p({ fecha })], hoy).grupos[0]!.pedidos[0]!;
    expect(f('2026-11-01')).toMatchObject({ dias: 30, atrasado: false });
    expect(f('2026-10-31')).toMatchObject({ dias: 31, atrasado: true });
  });
});
