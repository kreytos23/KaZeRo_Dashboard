import { ResponseCookies } from 'next/dist/compiled/@edge-runtime/cookies';
import { describe, expect, it } from 'vitest';
import { COOKIE_SESION, opcionesBorrado, opcionesCookie } from '@/server/auth/cookies';

describe('cookies __Host-', () => {
  it('opcionesCookie cumple los invariantes de __Host-', () => {
    const o = opcionesCookie(60);
    expect(o).toMatchObject({ secure: true, httpOnly: true, path: '/', sameSite: 'lax', maxAge: 60 });
    expect(o).not.toHaveProperty('domain');
  });

  it('opcionesBorrado conserva Secure/Path=/ y expira la cookie', () => {
    const o = opcionesBorrado();
    expect(o).toMatchObject({ secure: true, httpOnly: true, path: '/', sameSite: 'lax', maxAge: 0 });
    expect(o.expires.getTime()).toBe(0);
    expect(o).not.toHaveProperty('domain');
  });

  it('el Set-Cookie real de borrado incluye Secure, HttpOnly y Path=/', () => {
    const cabeceras = new Headers();
    new ResponseCookies(cabeceras).set(COOKIE_SESION, '', opcionesBorrado());
    const sc = cabeceras.get('set-cookie') ?? '';
    expect(sc).toMatch(/^__Host-kz_sesion=;/);
    expect(sc).toContain('Secure');
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('Path=/');
    expect(sc).toMatch(/SameSite=lax/i);
    expect(sc).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(sc).not.toMatch(/Domain=/i);
  });
});
