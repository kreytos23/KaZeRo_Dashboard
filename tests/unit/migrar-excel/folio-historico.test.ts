import { describe, expect, it } from 'vitest';
import { folioHistoricoDelPlan } from '../../../scripts/migrar-excel/aplicar';

type Pedidos = Parameters<typeof folioHistoricoDelPlan>[0]['pedidos'];
const pedidos = (xs: { tipo: string; folio: number }[]) => xs as unknown as Pedidos;

describe('folioHistoricoDelPlan', () => {
  it('respeta una frontera configurada mayor que el defecto (no la acota a 100001)', () => {
    const plan = {
      pedidos: pedidos([
        { tipo: 'kzr', folio: 12 },
        { tipo: 'historico', folio: 200001 },
        { tipo: 'historico', folio: 200002 },
      ]),
    };
    expect(folioHistoricoDelPlan(plan)).toBe(200001);
  });

  it('usa el defecto cuando el plan no tiene pedidos históricos', () => {
    expect(folioHistoricoDelPlan({ pedidos: pedidos([{ tipo: 'kzr', folio: 5 }]) })).toBe(100001);
  });
});
