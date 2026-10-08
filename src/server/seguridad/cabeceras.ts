export interface Cabecera {
  key: string;
  value: string;
}

/**
 * CSP estricta con nonce. Si agregas un tercero (script, imagen, conexión), declara aquí su origen.
 * Si lo quitas, quita también el permiso (lecciones §4). tesseract.js y sus datos se sirven desde
 * nuestro dominio (Plan 4), así que no requieren orígenes externos.
 * style-src permite 'unsafe-inline' porque Next/Tailwind inyectan estilos; los scripts NO.
 */
export function construirCsp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function cabecerasEstaticas(): Cabecera[] {
  return [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  ];
}
