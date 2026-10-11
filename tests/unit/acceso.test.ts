import { describe, expect, it } from 'vitest';
import { decidirAcceso } from '@/server/seguridad/acceso';

describe('decidirAcceso (proxy)', () => {
  it.each([
    ['/login', false, 'pasar'],
    ['/login/verificar', false, 'pasar'],
    ['/login/', false, 'pasar'],
    ['/api/health', false, 'pasar'],
    ['/api/health/listo', false, 'pasar'],
    ['/robots.txt', false, 'pasar'],
    ['/icon.svg', false, 'pasar'],
    ['/icon.svg/x', false, 'redirigir_login'],
    ['/icon.svgx', false, 'redirigir_login'],
    ['/login-evil', false, 'redirigir_login'],
    ['/loginx/verificar', false, 'redirigir_login'],
    ['/LOGIN', false, 'redirigir_login'],
    ['/Login/verificar', false, 'redirigir_login'],
    ['//login', false, 'redirigir_login'],
    ['/login/../panel', false, 'redirigir_login'],
    ['/login/%2e%2e/panel', false, 'redirigir_login'],
    ['/robots.txt/x', false, 'redirigir_login'],
    ['/panel', false, 'redirigir_login'],
    ['/', false, 'redirigir_login'],
    ['/api/healthz', false, 'no_autenticado'],
    ['/api/health/../busqueda/indice', false, 'no_autenticado'],
    ['/api/health/%2e%2e/x', false, 'no_autenticado'],
    ['/API/health', false, 'redirigir_login'],
    ['/api', false, 'no_autenticado'],
    ['/api/busqueda/indice', false, 'no_autenticado'],
    ['/api/busqueda/indice/', false, 'no_autenticado'],
    ['/panel', true, 'pasar'],
    ['/api/busqueda/indice', true, 'pasar'],
  ] as const)('%s con cookie=%s → %s', (ruta, cookie, esperado) => {
    expect(decidirAcceso(ruta, cookie)).toBe(esperado);
  });
});
