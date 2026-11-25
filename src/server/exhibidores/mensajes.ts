// Textos del dinero del exhibidor (Plan 4a): los usa el servicio y también la traducción de los constraints de la BD
// (última barrera), para que la clienta lea siempre la misma frase.

export const MSG_EXHIBIDOR_CERRADO = 'El exhibidor está cerrado.';
export const MSG_EXHIBIDOR_NO_SE_EDITA = 'Un exhibidor cerrado ya no se edita.';
export const MSG_ASOCIADO_CON_VENTAS =
  'Este exhibidor ya tiene ventas o dinero: su asociado no se puede cambiar.';
export const MSG_FECHA_FUTURA = 'La fecha no puede ser futura.';
export const MSG_NOTA_LARGA = 'La nota admite hasta 200 caracteres.';
export const MSG_MOTIVO_AJUSTE = 'Escribe el motivo del ajuste (hasta 200 caracteres).';
export const MSG_MONTO_MAYOR_CERO = 'El monto debe ser mayor que cero.';
export const MSG_COBRO_SIN_SALDO_FAVOR =
  'Un cobro del exhibidor no puede ser con saldo a favor: el dinero lo recibió el exhibidor.';

/** Con montos, el mensaje del servicio; sin ellos, el de la barrera de la BD (que no los conoce). */
export function mensajeEntregaExcede(actual?: string, pedido?: string): string {
  return actual && pedido
    ? `El exhibidor tiene ${actual} por entregar; no puedes registrar ${pedido}.`
    : 'El exhibidor no tiene tanto por entregar; no puedes registrar ese monto.';
}

export function mensajeCierreConDinero(porEntregar?: string): string {
  return `Antes de cerrar, registra la entrega de ${porEntregar ?? 'todo el dinero'} que tiene por entregar.`;
}
