// Textos de pagos del Plan 4b: los usa el servicio y también la traducción de los constraints de la BD (última
// barrera), para que la clienta lea siempre la misma frase.

export const MSG_OTRA_VENDEDORA = 'El pago de una vendedora solo se aplica a sus pedidos.';
export const MSG_PAGO_ANULADO = 'El pago está anulado.';
export const MSG_COMPROBANTE_REPETIDO = 'Esa captura ya está registrada en otro pago.';
export const MSG_REFERENCIA_LARGA = 'La referencia admite hasta 60 caracteres.';

// P-5: deshacer un pago.
export const MSG_MOTIVO_ANULACION = 'Escribe el motivo para deshacer el pago (hasta 200 caracteres).';
export const MSG_YA_ANULADO = 'El pago ya se deshizo.';
export const MSG_APLICACION_PREVIA =
  'No se puede deshacer: un pedido de este pago se canceló y lo abonado ya pasó a saldo a favor.';
export const MSG_EXHIBIDOR_NEGATIVO =
  'No se puede deshacer: el exhibidor ya entregó ese dinero y su por entregar quedaría negativo. Registra primero un ajuste.';
export function mensajeSobranteUsado(sobrante?: string, saldo?: string): string {
  const detalle = sobrante && saldo ? ` (sobrante ${sobrante}, saldo a favor ${saldo})` : '';
  return `No se puede deshacer: el sobrante de este pago ya se usó${detalle}. Primero deshaz lo que lo usó.`;
}
export const MSG_PAGO_NO_EXISTE = 'El pago no existe.';
export function mensajePiezasNoVendidas(piezas: string[]): string {
  return `Las piezas del pedido ya no están vendidas: ${piezas.join(', ')}. Recarga la página.`;
}

// Al reabrir, una devolución ya está en el saldo a favor: cancelar dejaría ese crédito sin respaldo.
export const MSG_CANCELAR_CON_DEVOLUCIONES =
  'Este pedido tiene piezas devueltas: no se puede cancelar. Registra el pago de lo que se queda.';
