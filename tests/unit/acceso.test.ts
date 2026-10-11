import { describe, expect, it } from 'vitest';
import { cacheControlPara, decidirAcceso } from '@/server/seguridad/acceso';

describe('decidirAcceso (proxy)', () => {
  it.each([
    ['/login', false, 'pasar'],
    ['/login/verificar', false, 'pasar'],
    ['/login/', false, 'pasar'],
    ['/api/health', false, 'pasar'],
    ['/api/health/listo', false, 'pasar'],
    ['/robots.txt', false, 'pasar'],
    ['/icon.png', false, 'pasar'],
    ['/apple-icon.png', false, 'pasar'],
    ['/favicon.ico', false, 'pasar'],
    ['/favicon.icoX', false, 'redirigir_login'],
    ['/icon.png/x', false, 'redirigir_login'],
    ['/icon.pngx', false, 'redirigir_login'],
    ['/icon.svg', false, 'redirigir_login'],
    ['/marca/logo-k.webp', false, 'pasar'],
    ['/marca/logo-horizontal.webp', false, 'pasar'],
    ['/marca/otro.png', false, 'pasar'],
    ['/marca', false, 'redirigir_login'],
    ['/marca/', false, 'redirigir_login'],
    ['/marca/logo-k.webp/', false, 'redirigir_login'],
    ['/marca/logo-k.webp/x', false, 'redirigir_login'],
    ['/marca/sub/logo.webp', false, 'redirigir_login'],
    ['/marca/../panel', false, 'redirigir_login'],
    ['/marca/..%2fpanel.webp', false, 'redirigir_login'],
    ['/marca/%2e%2e.webp', false, 'redirigir_login'],
    ['/marca//logo-k.webp', false, 'redirigir_login'],
    ['/marca/Logo-K.webp', false, 'redirigir_login'],
    ['/marca/logo-k.svg', false, 'redirigir_login'],
    ['/marca/logo-k.webpx', false, 'redirigir_login'],
    ['/MARCA/logo-k.webp', false, 'redirigir_login'],
    ['/x/marca/logo-k.webp', false, 'redirigir_login'],
    ['/api/marca/logo-k.webp', false, 'no_autenticado'],
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

describe('cacheControlPara (proxy)', () => {
  const PUBLICA = 'public, max-age=86400';
  it.each([
    '/icon.png',
    '/apple-icon.png',
    '/favicon.ico',
    '/marca/logo-k.webp',
    '/marca/logo-horizontal.webp',
    '/marca/otro.png',
  ])('%s: recurso estático público, cache de un día (sin immutable: el nombre no lleva hash)', (ruta) => {
    expect(cacheControlPara(ruta)).toBe(PUBLICA);
  });
  it.each([
    '/',
    '/login',
    '/panel',
    '/panel/vendedores',
    '/api/busqueda/indice',
    '/api/health',
    '/robots.txt',
    '/favicon.icoX',
    '/icon.png/',
    '/marca/sub/logo.webp',
    '/marca/logo-k.webp/',
    '/marca/Logo-K.webp',
    '/marca/..%2fpanel.webp',
  ])('%s: HTML/API o ruta dudosa, nunca se cachea', (ruta) => {
    expect(cacheControlPara(ruta)).toBe('private, no-store');
  });
});
