import { describe, expect, it } from 'vitest';
import { estaActivaBarra } from '@/app/panel/barra-inferior';

describe('estaActivaBarra', () => {
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
  ])('%s con %s -> %s', (ruta, href, esperado) => {
    expect(estaActivaBarra(ruta, href)).toBe(esperado);
  });
});
