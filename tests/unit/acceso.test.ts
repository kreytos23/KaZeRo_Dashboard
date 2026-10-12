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

describe('ruta de foto de pieza', () => {
  const RUTA = '/api/piezas/0b6f2c1e-3f4a-4c5d-8e9f-a0b1c2d3e4f5/imagen';
  it('sin cookie: 401 JSON (API privada)', () => {
    expect(decidirAcceso(RUTA, false)).toBe('no_autenticado');
  });
  it('el proxy no decide su caché (la pone el handler); variantes dudosas siguen sin caché', () => {
    expect(cacheControlPara(RUTA)).toBeNull();
    expect(cacheControlPara(`${RUTA}/`)).toBe('private, no-store');
    expect(cacheControlPara('/api/piezas/x/imagen')).toBe('private, no-store');
    expect(cacheControlPara('/api/busqueda/indice')).toBe('private, no-store');
  });
});

describe('tarea programada de limpieza', () => {
  it('el proxy la deja pasar sin cookie (la protege CRON_SECRET en el handler), solo la ruta exacta', () => {
    expect(decidirAcceso('/api/tareas/limpiar-imagenes', false)).toBe('pasar');
    expect(decidirAcceso('/api/tareas/limpiar-imagenes/x', false)).toBe('no_autenticado');
    expect(decidirAcceso('/api/tareas', false)).toBe('no_autenticado');
    expect(decidirAcceso('/api/tareas/otra', false)).toBe('no_autenticado');
    expect(cacheControlPara('/api/tareas/limpiar-imagenes')).toBe('private, no-store');
  });
  it.each([
    '/api/tareas/limpiar-imagenes/',
    '/api/tareas/limpiar-imagenes//',
    '/api/Tareas/limpiar-imagenes',
    '/api/tareas/Limpiar-Imagenes',
    '/api/tareas/limpiar-imagenes/..',
    '/api/tareas/../limpiar-imagenes',
    '/api/tareas/./limpiar-imagenes',
    '/api/tareas/limpiar-imagenes%2f',
    '/api/tareas/limpiar%2dimagenes',
    '/api/tareas/limpiar-imagenes\\',
    '/api/tareas/limpiar-imagenesx',
    '/api//tareas/limpiar-imagenes',
    '/api/tareas/limpiar-imagenes.json',
  ])('%s: variante dudosa, sigue privada (401 sin cookie)', (ruta) => {
    expect(decidirAcceso(ruta, false)).toBe('no_autenticado');
  });
  it('fuera de /api la ruta no es pública', () => {
    expect(decidirAcceso('/x/api/tareas/limpiar-imagenes', false)).toBe('redirigir_login');
  });
});
