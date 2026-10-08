/** Comprueba lo que el servidor sirve de verdad (lecciones §4). Devuelve la lista de fallos (vacía = OK). */
export async function verificarDespliegue(
  base: string,
  o: { commitEsperado: string; bypass?: string },
): Promise<string[]> {
  const fallos: string[] = [];
  const cabeceras: Record<string, string> = o.bypass ? { 'x-vercel-protection-bypass': o.bypass } : {};
  const pedir = (ruta: string) => fetch(new URL(ruta, base), { headers: cabeceras, redirect: 'manual' });

  const salud = await pedir('/api/health');
  if (salud.status !== 200) fallos.push(`/api/health respondió ${salud.status}`);
  else {
    const cuerpo = (await salud.json()) as { commit?: string };
    if (cuerpo.commit !== o.commitEsperado)
      fallos.push(`commit servido ${cuerpo.commit} ≠ esperado ${o.commitEsperado}`);
  }

  const login = await pedir('/login');
  const html = await login.text();
  if (login.status !== 200 || !html.includes('Iniciar sesión'))
    fallos.push(`/login no sirvió la pantalla de inicio (${login.status})`);
  const csp = login.headers.get('content-security-policy') ?? '';
  if (!csp.includes("frame-ancestors 'none'") || !/'nonce-[^']+'/.test(csp))
    fallos.push('CSP ausente o sin nonce');
  if (!(login.headers.get('cache-control') ?? '').includes('no-store'))
    fallos.push('Cache-Control sin no-store');
  if (login.headers.get('x-robots-tag') !== 'noindex, nofollow') fallos.push('falta X-Robots-Tag');

  const privada = await pedir('/panel');
  const destino = privada.headers.get('location') ?? '';
  if (![307, 308].includes(privada.status) || !destino.endsWith('/login'))
    fallos.push(`/panel sin sesión no redirigió a /login (${privada.status})`);
  // La redirección la genera el proxy (no Next): aquí sí depende de que el proxy ponga no-store.
  if (!(privada.headers.get('cache-control') ?? '').includes('no-store'))
    fallos.push('Cache-Control sin no-store en la redirección de /panel');

  return fallos;
}
