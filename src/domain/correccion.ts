type Estado = 'disponible' | 'en_exhibidor' | 'apartada' | 'vendida' | 'regalo' | 'defecto' | 'guardada';

export interface UltimoMovimiento {
  tipo: string;
  deEstado: Estado | null;
  aEstado: Estado;
  exhibidorId: string | null;
}
export interface DestinoCorreccion {
  aEstado: 'disponible' | 'en_exhibidor';
  exhibidorId: string | null;
  /** Venía de un exhibidor que ya se cerró: queda disponible y se avisa. */
  exhibidorCerrado: boolean;
}

const CORREGIBLES: readonly Estado[] = ['regalo', 'defecto', 'guardada'];

/**
 * R-07: a dónde vuelve una pieza al deshacer su último cambio, o null si no se puede.
 * Espejo de la rama de corrección de kz_validar_transicion_pieza (0009): el trigger es la última barrera.
 */
export function destinoCorreccion(
  estadoActual: Estado,
  ultimo: UltimoMovimiento | null | undefined,
  exhibidorAbierto: boolean,
): DestinoCorreccion | null {
  if (!ultimo || ultimo.tipo !== 'cambio_estado') return null;
  if (!CORREGIBLES.includes(estadoActual) || ultimo.aEstado !== estadoActual) return null;
  if (ultimo.deEstado === 'disponible')
    return { aEstado: 'disponible', exhibidorId: null, exhibidorCerrado: false };
  if (ultimo.deEstado === 'en_exhibidor' && ultimo.exhibidorId) {
    return exhibidorAbierto
      ? { aEstado: 'en_exhibidor', exhibidorId: ultimo.exhibidorId, exhibidorCerrado: false }
      : { aEstado: 'disponible', exhibidorId: null, exhibidorCerrado: true };
  }
  return null;
}

export function describirDestino(d: DestinoCorreccion, exhibidorNombre: string | null): string {
  if (d.aEstado === 'en_exhibidor') return `La pieza volverá al exhibidor ${exhibidorNombre}.`;
  if (d.exhibidorCerrado)
    return `La pieza volverá a Disponible: el exhibidor ${exhibidorNombre} ya está cerrado.`;
  return 'La pieza volverá a Disponible.';
}

export function mensajeCorreccion(r: {
  aEstado: 'disponible' | 'en_exhibidor';
  exhibidorNombre: string | null;
  exhibidorCerrado: boolean;
}): string {
  if (r.aEstado === 'en_exhibidor')
    return `Cambio deshecho: la pieza volvió al exhibidor ${r.exhibidorNombre}.`;
  if (r.exhibidorCerrado)
    return `Cambio deshecho. El exhibidor ${r.exhibidorNombre} está cerrado: la pieza quedó disponible.`;
  return 'Cambio deshecho: la pieza volvió a Disponible.';
}
