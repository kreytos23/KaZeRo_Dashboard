// Rutas públicas y sus subrutas por segmento, más archivos públicos que solo valen exactos.
const PUBLICAS = ['/login', '/api/health'];
const ARCHIVOS_PUBLICOS = ['/robots.txt'];

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
  return PUBLICAS.some((p) => sinBarraFinal === p || sinBarraFinal.startsWith(`${p}/`));
}

/** Sin cookie: las páginas redirigen a /login; las APIs responden 401 JSON (un fetch no debe recibir HTML). */
export function decidirAcceso(ruta: string, tieneCookie: boolean): DecisionAcceso {
  if (tieneCookie || esPublica(ruta)) return 'pasar';
  return ruta === '/api' || ruta.startsWith('/api/') ? 'no_autenticado' : 'redirigir_login';
}
