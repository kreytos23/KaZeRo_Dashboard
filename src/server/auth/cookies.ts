// Prefijo __Host-: exige Secure, Path=/ y sin Domain. Path=/ es a propósito: con Path=/panel la cookie
// no viajaría a /api/* y las subidas responderían "sesión expirada" con la sesión perfecta (lecciones §5).
// Chrome acepta cookies Secure en http://localhost, así que E2E local funciona.
export const COOKIE_SESION = '__Host-kz_sesion';
export const COOKIE_PRE = '__Host-kz_pre';

export function opcionesCookie(maxAgeSeg: number) {
  return { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: maxAgeSeg };
}
