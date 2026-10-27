const NUEVO = '/panel/pedidos/nuevo';

/** Pestaña activa de la barra inferior: Inicio solo en `/panel`; Pedidos no se enciende en «Nuevo pedido». */
export function estaActivaBarra(ruta: string, href: string): boolean {
  if (href === '/panel') return ruta === href;
  if (href !== NUEVO && (ruta === NUEVO || ruta.startsWith(`${NUEVO}/`))) return false;
  return ruta === href || ruta.startsWith(`${href}/`);
}
