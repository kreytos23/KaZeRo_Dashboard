import { describe, expect, it } from 'vitest';
import { leerFiltrosPedidos } from '@/app/panel/pedidos/filtros';

describe('leerFiltrosPedidos', () => {
  it('acepta valores válidos', () => {
    expect(
      leerFiltrosPedidos({
        q: 'kzr-3',
        estado: 'abierto',
        vendedor: '0b0e4c43-4a6b-4a1f-9a5e-2f9d8d1e7c11',
        saldo: '1',
        pagina: '2',
      }),
    ).toEqual({
      q: 'kzr-3',
      estado: 'abierto',
      vendedor: '0b0e4c43-4a6b-4a1f-9a5e-2f9d8d1e7c11',
      conSaldo: true,
      pagina: 2,
    });
  });
  it('descarta lo inválido sin lanzar', () => {
    expect(
      leerFiltrosPedidos({ estado: 'borrado', vendedor: 'x', saldo: 'si', pagina: '-1', q: 'a'.repeat(500) }),
    ).toEqual({
      q: 'a'.repeat(120),
      estado: undefined,
      vendedor: undefined,
      conSaldo: false,
      pagina: 1,
    });
  });
});
