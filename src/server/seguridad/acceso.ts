// Rutas públicas y sus subrutas por segmento, más archivos públicos que solo valen exactos.
const PUBLICAS = ['/login', '/api/health'];
// Iconos que Next genera desde src/app (el login sin sesión también los pide). `/favicon.ico` no
// pasa por el proxy (ver matcher en src/proxy.ts), así que no hace falta listarlo.
const ARCHIVOS_PUBLICOS = ['/robots.txt', '/icon.png', '/apple-icon.png'];
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
