/**
 * Aviso del login según `?motivo=`. Solo se reconoce un valor exacto y fijo; cualquier otro se ignora
 * y el parámetro nunca se refleja en la página.
 */
export function avisoDeMotivo(motivo: string | string[] | undefined): string | null {
  return motivo === 'bloqueado' ? 'Demasiados intentos. Intenta más tarde.' : null;
}
