import { afterEach, describe, expect, it, vi } from 'vitest';
import { verificarDespliegue } from '../../scripts/lib/smoke';

const BASE = 'https://kazero.example';
const CSP = "default-src 'self'; script-src 'nonce-abc123'; frame-ancestors 'none'";

/** Respuestas de un despliegue sano; cada prueba sobreescribe la ruta que quiere romper. */
function respuestasSanas(): Record<string, () => Response> {
  return {
    '/api/health': () => Response.json({ status: 'ok', commit: 'abc' }),
    '/api/health/listo': () => Response.json({ status: 'ok', db: 'ok' }),
    '/login': () =>
      new Response('<h1>Iniciar sesión</h1>', {
        headers: {
          'content-security-policy': CSP,
          'cache-control': 'private, no-store',
          'x-robots-tag': 'noindex, nofollow',
        },
      }),
    '/panel': () =>
      new Response(null, {
        status: 307,
        headers: { location: `${BASE}/login`, 'cache-control': 'private, no-store' },
      }),
  };
}

function simularFetch(rutas: Record<string, () => Response | Promise<Response>>) {
  const f = vi.fn(async (url: URL | string, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const r = rutas[new URL(url).pathname];
    if (!r) throw new Error(`ruta inesperada ${String(url)}`);
    return r();
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('verificarDespliegue', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('un despliegue sano no tiene fallos', async () => {
    simularFetch(respuestasSanas());
    expect(await verificarDespliegue(BASE, { commitEsperado: 'abc' })).toEqual([]);
  });

  it('exige /api/health/listo con db ok', async () => {
    simularFetch({
      ...respuestasSanas(),
      '/api/health/listo': () => Response.json({ status: 'error' }, { status: 503 }),
    });
    const fallos = await verificarDespliegue(BASE, { commitEsperado: 'abc' });
    expect(fallos).toEqual([expect.stringContaining('/api/health/listo')]);
  });

  it('un timeout o error de red es un fallo legible, no una excepción', async () => {
    simularFetch({
      ...respuestasSanas(),
      '/api/health': () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      '/login': () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })),
    });
    const fallos = await verificarDespliegue(BASE, { commitEsperado: 'abc' });
    expect(fallos).toEqual(['/api/health: sin respuesta en 15 s', '/login: error de red (ECONNREFUSED)']);
  });
});
