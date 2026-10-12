// Rutas públicas y sus subrutas por segmento, más archivos públicos que solo valen exactos.
const PUBLICAS = ['/login', '/api/health'];
// Iconos que Next genera desde src/app (el login sin sesión también los pide).
const ICONOS = ['/icon.png', '/apple-icon.png', '/favicon.ico'];
const ARCHIVOS_PUBLICOS = ['/robots.txt', ...ICONOS];
// Imágenes de marca de public/marca: un único segmento con nombre simple, sin subcarpetas.
const IMAGEN_MARCA = /^\/marca\/[a-z0-9-]+\.(?:webp|png)$/;

export type DecisionAcceso = 'pasar' | 'redirigir_login' | 'no_autenticado';

/**
 * Pública solo si es EXACTAMENTE una ruta pública o cuelga de ella por segmentos completos
 * (distingue mayúsculas: `/LOGIN` no es pública). Cualquier segmento vacío, `.`, `..`, con `%` o `\`
 * (intentos de recorrido o codificación) invalida la ruta: ante la duda, exige sesión.
 */
function esPublica(ruta: string) {
  if (!ruta.startsWith('/')) return false;
  const sinBarraFinal = ruta.length > 1 && ruta.endsWith('/') ? ruta.slice(0, -1) : ruta;
  const segmentos = sinBarraFinal.slice(1).split('/');
  if (segmentos.some((s) => s === '' || s === '.' || s === '..' || s.includes('%') || s.includes('\\')))
    return false;
  if (ARCHIVOS_PUBLICOS.includes(sinBarraFinal)) return true;
  // Contra la ruta original, no la recortada: `/marca/logo.webp/` no es un archivo.
  if (IMAGEN_MARCA.test(ruta)) return true;
  return PUBLICAS.some((p) => sinBarraFinal === p || sinBarraFinal.startsWith(`${p}/`));
}

/** Sin cookie: las páginas redirigen a /login; las APIs responden 401 JSON (un fetch no debe recibir HTML). */
export function decidirAcceso(ruta: string, tieneCookie: boolean): DecisionAcceso {
  if (tieneCookie || esPublica(ruta)) return 'pasar';
  return ruta === '/api' || ruta.startsWith('/api/') ? 'no_autenticado' : 'redirigir_login';
}

// Foto de pieza (Plan 2.2): su Cache-Control lo decide el handler (inmutable solo con la clave vigente).
const RUTA_IMAGEN_PIEZA =
  /^\/api\/piezas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/imagen$/;

/**
 * Solo los iconos y las imágenes de marca (binarios públicos, sin datos) se cachean, por un día y sin
 * `immutable`: sus nombres no llevan hash y un cambio de logo debe verse al día siguiente. HTML y APIs
 * nunca se cachean (lecciones §5). Se compara contra la ruta exacta, igual que en `esPublica`.
 * `null`: la ruta de la foto de una pieza pone su propia cabecera (el proxy no la pisa).
 */
export function cacheControlPara(ruta: string): string | null {
  if (RUTA_IMAGEN_PIEZA.test(ruta)) return null;
  return ICONOS.includes(ruta) || IMAGEN_MARCA.test(ruta) ? 'public, max-age=86400' : 'private, no-store';
}
