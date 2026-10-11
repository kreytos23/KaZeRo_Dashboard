import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_SESION } from '@/server/auth/cookies';
import { decidirAcceso } from '@/server/seguridad/acceso';
import { construirCsp } from '@/server/seguridad/cabeceras';

/**
 * Next 16: `proxy.ts` reemplaza a `middleware.ts`. Aquí solo se redirige si NO hay cookie (barato);
 * la validación real de la sesión ocurre en el servidor (panel/layout.tsx y cada acción).
 */
export function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = construirCsp(nonce, process.env.NODE_ENV === 'development');

  const decision = decidirAcceso(req.nextUrl.pathname, req.cookies.has(COOKIE_SESION));
  let res: NextResponse;
  if (decision === 'redirigir_login') {
    res = NextResponse.redirect(new URL('/login', req.url));
  } else if (decision === 'no_autenticado') {
    res = NextResponse.json({ error: 'no_autenticado' }, { status: 401 });
  } else {
    const cabeceras = new Headers(req.headers);
    cabeceras.set('x-nonce', nonce);
    cabeceras.set('Content-Security-Policy', csp);
    res = NextResponse.next({ request: { headers: cabeceras } });
  }
  res.headers.set('Content-Security-Policy', csp);
  // El panel nunca se cachea (lecciones §5).
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

export const config = {
  // Se excluyen solo los estáticos exactos: `/favicon.icoX` o `/_next/staticx` (que dan 404) también
  // deben pasar por el proxy para llevar CSP y cabeceras de seguridad. `/icon.svg` pasa y es pública.
  matcher: ['/((?!_next/static/|_next/image|favicon\\.ico$).*)'],
};
