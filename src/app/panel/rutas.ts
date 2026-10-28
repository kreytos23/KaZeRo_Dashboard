/**
 * ¿Está activa la ruta `href`? Inicio solo en `/panel`; las demás, en su ruta y las de abajo. `rutas` son las
 * demás rutas que compiten por la marca: si una más específica (p. ej. «Nuevo pedido» frente a «Pedidos»)
 * también coincide, gana esa y `href` no se marca.
 */
export function estaActiva(ruta: string, href: string, rutas: readonly string[] = []): boolean {
  if (href === '/panel') return ruta === href;
  const coincide = (h: string) => ruta === h || ruta.startsWith(`${h}/`);
  return coincide(href) && !rutas.some((h) => h.startsWith(`${href}/`) && coincide(h));
}
