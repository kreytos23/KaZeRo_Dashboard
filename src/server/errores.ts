import { pgCode, pgConstraint } from '@/db/errors';

export class ErrorNegocio extends Error {
  override name = 'ErrorNegocio';
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly campo?: string,
  ) {
    super(mensaje);
  }
}

/** Restricción de la BD → nombre del campo en el formulario, para mostrar el error junto a él. */
const CAMPOS: Record<string, string> = {
  pieza_codigo_uq: 'codigo',
  pieza_imagen_clave_uq: 'imagen',
  pieza_codigo_formato: 'codigo',
  pieza_descripcion_largo: 'descripcion',
  pieza_montos: 'precio',
  vendedor_nombre_uq: 'nombre',
  vendedor_nombre_largo: 'nombre',
  vendedor_comision_rango: 'comision',
  categoria_nombre_uq: 'nombre',
  categoria_nombre_largo: 'nombre',
  material_nombre_uq: 'nombre',
  material_nombre_largo: 'nombre',
  proveedor_nombre_uq: 'nombre',
  proveedor_nombre_largo: 'nombre',
  cliente_nombre_largo: 'nombre',
  cliente_referencia_largo: 'referencia',
  cliente_telefono_largo: 'telefono',
  cliente_red_social_largo: 'redSocial',
  cliente_usuario_red_largo: 'usuarioRed',
  cliente_notas_largo: 'notas',
  exhibidor_nombre_largo: 'nombre',
  movimiento_nota_largo: 'nota',
  auditoria_motivo_dinero: 'motivo',
  auditoria_motivo_largo: 'motivo',
  movimiento_correccion_completa: 'motivo',
  // Plan 3: pedidos y pagos.
  pedido_item_pieza_activa_uq: 'codigos',
  pedido_descuento_manual: 'descuentoMotivo',
  pedido_total_no_negativo: 'descuentoManual',
  pedido_notas_largo: 'notas',
  pedido_cancelado_coherente: 'motivo',
  pago_monto_positivo: 'monto',
  aplicacion_pago_monto_positivo: 'monto',
  pago_nota_largo: 'nota',
  aplicacion_pago_excede_pago: 'monto',
  saldo_favor_insuficiente: 'monto',
  // Plan 3.1: custodia de vendedora, devoluciones y saldo a favor.
  pieza_cambio_custodia: 'codigos',
  devolucion_excede_linea: 'monto',
  devolucion_excede_total: 'monto',
  devolucion_fecha: 'fecha',
  devolucion_monto_positivo: 'monto',
  devolucion_motivo_largo: 'motivo',
  saldo_favor_retiro_completo: 'nota',
  saldo_favor_nota_largo: 'nota',
};

/** CHECK de coherencia interna de pedidos y pagos: la app nunca debería violarlos (son la última barrera). */
const PEDIDO_INCONSISTENTE = 'Los datos del pedido son inconsistentes. Recarga la página.';

const MENSAJES: Record<string, string> = {
  pieza_codigo_uq: 'Ya existe una pieza con ese código.',
  pieza_codigo_formato: 'El código solo admite letras, números y guiones (máx. 20).',
  pieza_transicion: 'Ese cambio de estado no está permitido para la pieza.',
  pieza_exhibidor_coherente: 'Una pieza en exhibidor debe tener exhibidor.',
  pieza_montos: 'El costo y el precio no pueden ser negativos.',
  pieza_cambio_exhibidor: 'La pieza debe regresar antes de cambiar de exhibidor.',
  exhibidor_cierre_coherente: 'El estado de cierre del exhibidor es inconsistente.',
  pieza_exhibidor_solo_si_aplica: 'Solo una pieza en exhibidor o apartada puede tener exhibidor.',
  pieza_imagen_clave_uq: 'Esa foto ya está asociada a otra pieza. Vuelve a intentarlo.',
  pieza_foto_path_largo: 'La ruta de la foto es demasiado larga.',
  cliente_referencia_largo: 'La referencia admite hasta 120 caracteres.',
  cliente_telefono_largo: 'El teléfono admite hasta 30 caracteres.',
  cliente_red_social_largo: 'La red social admite hasta 40 caracteres.',
  cliente_usuario_red_largo: 'El usuario admite hasta 80 caracteres.',
  cliente_notas_largo: 'Las notas admiten hasta 2000 caracteres.',
  vendedor_nombre_uq: 'Ya existe un vendedor con ese nombre.',
  vendedor_comision_rango: 'La comisión debe estar entre 0 y 100.',
  vendedor_nombre_largo: 'El nombre debe tener entre 1 y 80 caracteres.',
  cliente_nombre_largo: 'El nombre debe tener entre 1 y 120 caracteres.',
  exhibidor_nombre_largo: 'El nombre debe tener entre 1 y 120 caracteres.',
  pieza_descripcion_largo: 'La descripción debe tener entre 1 y 300 caracteres.',
  categoria_nombre_largo: 'El nombre debe tener entre 1 y 80 caracteres.',
  material_nombre_largo: 'El nombre debe tener entre 1 y 80 caracteres.',
  proveedor_nombre_largo: 'El nombre debe tener entre 1 y 80 caracteres.',
  movimiento_nota_largo: 'La nota admite hasta 200 caracteres.',
  categoria_nombre_uq: 'Esa categoría ya existe.',
  material_nombre_uq: 'Ese material ya existe.',
  proveedor_nombre_uq: 'Ese proveedor ya existe.',
  codigo_recuperacion_usado: 'Un código de recuperación usado no puede modificarse.',
  admin_email_uq: 'Ya existe un administrador con ese correo.',
  auditoria_motivo_dinero: 'Escribe el motivo: cambiaste un monto.',
  auditoria_motivo_largo: 'El motivo admite hasta 200 caracteres.',
  auditoria_sin_admin: 'No se pudo registrar quién hizo el cambio. Recarga la página.',
  movimiento_correccion_completa: 'La corrección necesita un motivo.',
  movimiento_coherente: 'El movimiento no coincide con el historial de la pieza.',
  // Plan 3: pedidos y pagos.
  pedido_item_pieza_activa_uq: 'Una de las piezas ya está en otro pedido.',
  pedido_tarjeta_posicion_uq: 'Otra operación tomó esa posición de la tarjeta. Intenta de nuevo.',
  pedido_transicion: 'Ese cambio de estado no está permitido para el pedido.',
  pedido_descuento_manual: 'El descuento manual necesita un motivo (hasta 200 caracteres).',
  pedido_total_no_negativo: 'El total no puede ser negativo.',
  pedido_notas_largo: 'Las notas admiten hasta 500 caracteres.',
  pedido_cancelado_coherente: 'La cancelación necesita un motivo (hasta 200 caracteres).',
  pedido_folio_positivo: PEDIDO_INCONSISTENTE,
  pedido_tarjeta_coherente: PEDIDO_INCONSISTENTE,
  pedido_posicion_rango: PEDIDO_INCONSISTENTE,
  pedido_lealtad_pct_rango: PEDIDO_INCONSISTENTE,
  pedido_sin_lealtad_coherente: PEDIDO_INCONSISTENTE,
  pedido_liquidado_coherente: PEDIDO_INCONSISTENTE,
  pedido_item_precios: PEDIDO_INCONSISTENTE,
  pedido_item_quitado_coherente: PEDIDO_INCONSISTENTE,
  saldo_favor_un_titular: PEDIDO_INCONSISTENTE,
  saldo_favor_signo: PEDIDO_INCONSISTENTE,
  pago_un_pagador: PEDIDO_INCONSISTENTE,
  pago_monto_positivo: 'El monto debe ser mayor que cero.',
  aplicacion_pago_monto_positivo: 'El monto debe ser mayor que cero.',
  pago_nota_largo: 'La nota admite hasta 200 caracteres.',
  pago_idempotency_key_uq: 'Este pago ya se registró.',
  // Libro de pagos y columnas de solo avance (triggers de 0013).
  aplicacion_pago_excede_pago: 'Lo aplicado supera el monto del pago.',
  aplicacion_pago_pedido_cancelado: 'No se pueden aplicar pagos a un pedido cancelado.',
  aplicacion_pago_anulada_final: 'Una aplicación de pago anulada no puede cambiar.',
  pedido_item_vigente_final: 'Una pieza que salió del pedido no puede volver a esa línea.',
  pedido_item_quitado_final: 'Una pieza que salió del pedido no puede volver a esa línea.',
  saldo_favor_insuficiente: 'El saldo a favor no alcanza para ese monto.',
  saldo_favor_pedido_requerido: PEDIDO_INCONSISTENTE,
  // Plan 3.1 (0016/0017). Los nombres viejos (saldo_favor_signo, saldo_favor_pedido_requerido) se conservan
  // arriba por si un despliegue anterior los reporta durante la transición.
  pieza_una_ubicacion: 'Una pieza no puede estar en un exhibidor y con una vendedora a la vez.',
  pieza_custodia_solo_si_aplica: 'Solo una pieza disponible o apartada puede estar con una vendedora.',
  pieza_cambio_custodia:
    'La pieza debe estar disponible en Kazero para entregarse, y regresar antes de pasar a otra vendedora.',
  devolucion_pedido_item_uq: 'Esa pieza ya se devolvió.',
  devolucion_pedido_no_liquidado: 'Solo se devuelven piezas de pedidos liquidados.',
  devolucion_linea_no_vigente: 'Esa pieza ya no está en el pedido.',
  devolucion_pieza_no_vendida: 'La pieza no está vendida: no se puede devolver.',
  devolucion_excede_linea: 'La devolución no puede superar lo que costó la pieza en el pedido.',
  devolucion_excede_total: 'Lo devuelto no puede superar el total del pedido.',
  devolucion_fecha: 'La devolución no puede ser anterior a la fecha del pedido.',
  devolucion_monto_positivo: 'El monto debe ser mayor que cero.',
  devolucion_motivo_largo: 'Escribe el motivo de la devolución (hasta 200 caracteres).',
  saldo_favor_retiro_completo: 'El retiro necesita una nota (hasta 200 caracteres).',
  saldo_favor_nota_largo: 'La nota admite hasta 200 caracteres.',
  pago_saldo_favor_cliente: 'Solo una clienta puede pagar con su saldo a favor.',
  // Garantías internas del libro (CHECK, triggers y diferidos de 0017): la app nunca debería violarlas.
  saldo_favor_signo_v2: PEDIDO_INCONSISTENTE,
  saldo_favor_pedido_requerido_v2: PEDIDO_INCONSISTENTE,
  saldo_favor_origen: PEDIDO_INCONSISTENTE,
  saldo_favor_uso_incoherente: PEDIDO_INCONSISTENTE,
  saldo_favor_devolucion_incoherente: PEDIDO_INCONSISTENTE,
  saldo_favor_uso_faltante: PEDIDO_INCONSISTENTE,
  pago_saldo_sin_aplicacion: PEDIDO_INCONSISTENTE,
  devolucion_sin_saldo: PEDIDO_INCONSISTENTE,
};

function mensajesPg(err: unknown): string[] {
  const out: string[] = [];
  const vistos = new Set<unknown>();
  let actual: unknown = err;
  while (actual !== null && typeof actual === 'object' && !vistos.has(actual)) {
    vistos.add(actual);
    const m = (actual as { message?: unknown }).message;
    if (typeof m === 'string') out.push(m);
    actual = (actual as { cause?: unknown }).cause;
  }
  return out;
}

export function traducirErrorPg(err: unknown): ErrorNegocio | null {
  const constraint = pgConstraint(err);
  if (constraint && MENSAJES[constraint])
    return new ErrorNegocio(constraint, MENSAJES[constraint], CAMPOS[constraint]);
  if (pgCode(err) === '23503') return new ErrorNegocio('referencia', 'El registro relacionado no existe.');
  const code = pgCode(err);
  // Interbloqueo o fallo de serialización: la operación entera se revirtió, basta reintentar.
  if (code === '40P01' || code === '40001')
    return new ErrorNegocio(
      'conflicto_concurrente',
      'Otra operación modificó estos datos al mismo tiempo. Intenta de nuevo.',
    );
  if (code === '22P02') {
    // Solo el uuid mal formado (id manipulado) es "no encontrado"; el resto (numeric, enum, integer…) es dato inválido.
    if (mensajesPg(err).some((m) => /type uuid/i.test(m)))
      return new ErrorNegocio('no_encontrado', 'Registro no encontrado.');
    return new ErrorNegocio('dato_invalido', 'Uno de los datos no tiene un formato válido.');
  }
  return null;
}

/** Ejecuta y convierte errores conocidos de Postgres en ErrorNegocio; los demás se relanzan tal cual. */
export async function conErroresDeNegocio<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErrorNegocio) throw e;
    throw traducirErrorPg(e) ?? e;
  }
}

export function conflictoVersion(): ErrorNegocio {
  return new ErrorNegocio('conflicto', 'Otra pestaña modificó este registro. Recarga la página.');
}
