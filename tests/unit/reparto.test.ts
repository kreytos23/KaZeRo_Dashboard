import { describe, expect, it } from 'vitest';
import { repartoSugerido } from '@/domain/reparto';

const ped = (id: string, fecha: string, folio: number, saldoCentavos: number) => ({
  id,
  fecha,
  folio,
  saldoCentavos,
});

describe('repartoSugerido (R-33)', () => {
  it('reparte del pedido más viejo al más nuevo, con el folio como desempate', () => {
    const r = repartoSugerido(25000, [
      ped('c', '2026-03-01', 9, 10000),
      ped('b', '2026-02-01', 8, 10000),
      ped('a', '2026-02-01', 7, 10000),
    ]);
    expect(r).toEqual({
      aplicaciones: [
        { pedidoId: 'a', montoCentavos: 10000 },
        { pedidoId: 'b', montoCentavos: 10000 },
        { pedidoId: 'c', montoCentavos: 5000 },
      ],
      sobranteCentavos: 0,
    });
  });

  it('lo que sobra de todos los saldos queda como sobrante', () => {
    const r = repartoSugerido(30000, [ped('a', '2026-02-01', 1, 10000), ped('b', '2026-02-02', 2, 5000)]);
    expect(r.aplicaciones).toEqual([
      { pedidoId: 'a', montoCentavos: 10000 },
      { pedidoId: 'b', montoCentavos: 5000 },
    ]);
    expect(r.sobranteCentavos).toBe(15000);
  });

  it('un monto menor al primer saldo no toca los demás; ignora saldos en cero', () => {
    const r = repartoSugerido(3000, [
      ped('z', '2026-01-01', 1, 0),
      ped('a', '2026-02-01', 2, 10000),
      ped('b', '2026-02-02', 3, 5000),
    ]);
    expect(r).toEqual({ aplicaciones: [{ pedidoId: 'a', montoCentavos: 3000 }], sobranteCentavos: 0 });
  });

  it('sin pedidos todo es sobrante', () => {
    expect(repartoSugerido(1234, [])).toEqual({ aplicaciones: [], sobranteCentavos: 1234 });
  });
});
