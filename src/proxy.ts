import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_SESION } from '@/server/auth/cookies';
import { construirCsp } from '@/server/seguridad/cabeceras';

const PUBLICAS = ['/login', '/api/health', '/robots.txt'];

function esPublica(ruta: string) {
  return PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));
}

/**
 * Next 16: `proxy.ts` reemplaza a `middleware.ts`. Aquí solo se redirige si NO hay cookie (barato);
 * la validación real de la sesión ocurre en el servidor (panel/layout.tsx y cada acción).
 */
export function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = construirCsp(nonce, process.env.NODE_ENV === 'development');

  let res: NextResponse;
  if (!esPublica(req.nextUrl.pathname) && !req.cookies.has(COOKIE_SESION)) {
    res = NextResponse.redirect(new URL('/login', req.url));
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
