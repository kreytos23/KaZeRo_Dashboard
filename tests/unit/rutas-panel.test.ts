import { describe, expect, it } from 'vitest';
import { estaActiva } from '@/app/panel/rutas';

const BARRA = ['/panel', '/panel/pedidos', '/panel/pedidos/nuevo', '/panel/inventario', '/panel/reportes'];

describe('estaActiva', () => {
  it.each([
    ['/panel', '/panel', true],
    ['/panel/pedidos', '/panel', false],
    ['/panel/pedidos', '/panel/pedidos', true],
    ['/panel/pedidos/abc123', '/panel/pedidos', true],
    ['/panel/pedidos/nuevo', '/panel/pedidos', false],
    ['/panel/pedidos/nuevo', '/panel/pedidos/nuevo', true],
    ['/panel/inventario/x', '/panel/inventario', true],
    ['/panel/inventarios', '/panel/inventario', false],
    ['/panel/reportes', '/panel/reportes', true],
  ])('con la barra: %s con %s -> %s', (ruta, href, esperado) => {
    expect(estaActiva(ruta, href, BARRA)).toBe(esperado);
  });

  it('sin rutas que compitan, Pedidos sigue marcado en «Nuevo pedido» (menú de escritorio)', () => {
    expect(estaActiva('/panel/pedidos/nuevo', '/panel/pedidos')).toBe(true);
  });
});
