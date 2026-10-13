/** Límite de ramas del plan gratuito de Neon (override con KAZERO_LIMITE_RAMAS si el plan cambia). */
export const LIMITE_RAMAS_NEON = 10;

/**
 * Cuántas ramas de prueba se pueden crear sin llegar al límite del plan: se deja `reserva` rama libre
 * (otro CI, una rama manual). Nunca más de las pedidas; 0 significa que no cabe ninguna.
 */
export function trabajadoresDisponibles(
  pedidos: number,
  existentes: number,
  limite = LIMITE_RAMAS_NEON,
  reserva = 1,
): number {
  return Math.max(0, Math.min(pedidos, limite - existentes - reserva));
}

/** Número de workers pedido por el entorno (KAZERO_TEST_WORKERS); entero ≥ 1, por defecto 3. */
export function trabajadoresPedidos(valor: string | undefined, porDefecto = 3): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : porDefecto;
}
