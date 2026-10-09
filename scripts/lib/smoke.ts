const TIMEOUT_MS = 15_000;

/** Motivo legible de un fallo de red, sin stack ni mensajes largos del runtime. */
function motivoRed(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
    return `sin respuesta en ${TIMEOUT_MS / 1000} s`;
  const codigo = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return `error de red (${typeof codigo === 'string' ? codigo : err instanceof Error ? err.name : 'desconocido'})`;
}

/** Comprueba lo que el servidor sirve de verdad (lecciones §4). Devuelve la lista de fallos (vacía = OK). */
export async function verificarDespliegue(
  base: string,
  o: { commitEsperado: string; bypass?: string },
): Promise<string[]> {
  const fallos: string[] = [];
  const cabeceras: Record<string, string> = o.bypass ? { 'x-vercel-protection-bypass': o.bypass } : {};

  /** Ejecuta una comprobación; un timeout o error de red (también al leer el cuerpo) se vuelve un fallo. */
  async function comprobar(ruta: string, revisar: (r: Response) => Promise<void> | void) {
    try {
      const r = await fetch(new URL(ruta, base), {
        headers: cabeceras,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await revisar(r);
    } catch (err) {
      fallos.push(`${ruta}: ${motivoRed(err)}`);
    }
  }

  await comprobar('/api/health', async (salud) => {
    if (salud.status !== 200) return void fallos.push(`/api/health respondió ${salud.status}`);
    const cuerpo = (await salud.json()) as { commit?: string };
    if (cuerpo.commit !== o.commitEsperado)
      fallos.push(`commit servido ${cuerpo.commit} ≠ esperado ${o.commitEsperado}`);
  });

  // Readiness: el entorno es válido y kazero_app llega a la BD.
  await comprobar('/api/health/listo', async (listo) => {
    const cuerpo = listo.status === 200 ? ((await listo.json()) as { db?: string }) : {};
    if (listo.status !== 200 || cuerpo.db !== 'ok')
      fallos.push(`/api/health/listo respondió ${listo.status} (la app no está lista o no llega a la BD)`);
  });

  await comprobar('/login', async (login) => {
    const html = await login.text();
    if (login.status !== 200 || !html.includes('Iniciar sesión'))
      fallos.push(`/login no sirvió la pantalla de inicio (${login.status})`);
    const csp = login.headers.get('content-security-policy') ?? '';
    if (!csp.includes("frame-ancestors 'none'") || !/'nonce-[^']+'/.test(csp))
      fallos.push('CSP ausente o sin nonce');
    if (!(login.headers.get('cache-control') ?? '').includes('no-store'))
      fallos.push('Cache-Control sin no-store');
    if (login.headers.get('x-robots-tag') !== 'noindex, nofollow') fallos.push('falta X-Robots-Tag');
  });

  await comprobar('/panel', (privada) => {
    const destino = privada.headers.get('location') ?? '';
    if (![307, 308].includes(privada.status) || !destino.endsWith('/login'))
      fallos.push(`/panel sin sesión no redirigió a /login (${privada.status})`);
    // La redirección la genera el proxy (no Next): aquí sí depende de que el proxy ponga no-store.
    if (!(privada.headers.get('cache-control') ?? '').includes('no-store'))
      fallos.push('Cache-Control sin no-store en la redirección de /panel');
  });

  return fallos;
}
