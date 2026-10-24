import { describe, expect, it } from 'vitest';
import { ErrorNegocio, conErroresDeNegocio, traducirErrorPg } from '@/server/errores';

const envuelto = (pg: object) => new Error('Failed query', { cause: pg });

describe('traducción de errores de Postgres', () => {
  it('asocia la restricción violada con su campo del formulario', () => {
    expect(traducirErrorPg(envuelto({ code: '23505', constraint: 'vendedor_nombre_uq' }))?.campo).toBe(
      'nombre',
    );
    expect(traducirErrorPg(envuelto({ code: '23514', constraint: 'cliente_telefono_largo' }))?.campo).toBe(
      'telefono',
    );
    expect(
      traducirErrorPg(envuelto({ code: '23514', constraint: 'pieza_transicion' }))?.campo,
    ).toBeUndefined();
  });
  it('traduce la violación de código único', () => {
    const e = traducirErrorPg(envuelto({ code: '23505', constraint: 'pieza_codigo_uq' }));
    expect(e).toBeInstanceOf(ErrorNegocio);
    expect(e?.message).toBe('Ya existe una pieza con ese código.');
  });
  it('traduce las reglas de la bitácora al campo motivo', () => {
    const e = traducirErrorPg(envuelto({ code: 'P0001', constraint: 'auditoria_motivo_dinero' }));
    expect(e).toMatchObject({
      codigo: 'auditoria_motivo_dinero',
      campo: 'motivo',
      message: 'Escribe el motivo: cambiaste un monto.',
    });
    expect(
      traducirErrorPg(envuelto({ code: 'P0001', constraint: 'auditoria_sin_admin' }))?.campo,
    ).toBeUndefined();
    expect(
      traducirErrorPg(envuelto({ code: '23514', constraint: 'movimiento_correccion_completa' }))?.campo,
    ).toBe('motivo');
  });
  it('traduce el movimiento incoherente con la pieza', () => {
    const e = traducirErrorPg(envuelto({ code: 'P0001', constraint: 'movimiento_coherente' }));
    expect(e).toMatchObject({
      codigo: 'movimiento_coherente',
      message: 'El movimiento no coincide con el historial de la pieza.',
    });
    expect(e?.campo).toBeUndefined();
  });
  it('traduce la transición de pieza rechazada por el trigger', () => {
    expect(traducirErrorPg(envuelto({ code: 'P0001', constraint: 'pieza_transicion' }))?.codigo).toBe(
      'pieza_transicion',
    );
  });
  it.each([
    ['pedido_item_pieza_activa_uq', 'Una de las piezas ya está en otro pedido.', 'codigos'],
    [
      'pedido_tarjeta_posicion_uq',
      'Otra operación tomó esa posición de la tarjeta. Intenta de nuevo.',
      undefined,
    ],
    ['pedido_transicion', 'Ese cambio de estado no está permitido para el pedido.', undefined],
    [
      'pedido_descuento_manual',
      'El descuento manual necesita un motivo (hasta 200 caracteres).',
      'descuentoMotivo',
    ],
    ['pedido_total_no_negativo', 'El total no puede ser negativo.', 'descuentoManual'],
    ['pedido_notas_largo', 'Las notas admiten hasta 500 caracteres.', 'notas'],
    ['pedido_cancelado_coherente', 'La cancelación necesita un motivo (hasta 200 caracteres).', 'motivo'],
    ['pedido_tarjeta_coherente', 'Los datos del pedido son inconsistentes. Recarga la página.', undefined],
    ['saldo_favor_signo', 'Los datos del pedido son inconsistentes. Recarga la página.', undefined],
    ['pago_un_pagador', 'Los datos del pedido son inconsistentes. Recarga la página.', undefined],
    ['pago_monto_positivo', 'El monto debe ser mayor que cero.', 'monto'],
    ['aplicacion_pago_monto_positivo', 'El monto debe ser mayor que cero.', 'monto'],
    ['pago_nota_largo', 'La nota admite hasta 200 caracteres.', 'nota'],
    ['pago_idempotency_key_uq', 'Este pago ya se registró.', undefined],
    ['aplicacion_pago_excede_pago', 'Lo aplicado supera el monto del pago.', 'monto'],
    ['aplicacion_pago_pedido_cancelado', 'No se pueden aplicar pagos a un pedido cancelado.', undefined],
    ['aplicacion_pago_anulada_final', 'Una aplicación de pago anulada no puede cambiar.', undefined],
    ['pedido_item_vigente_final', 'Una pieza que salió del pedido no puede volver a esa línea.', undefined],
    ['pedido_item_quitado_final', 'Una pieza que salió del pedido no puede volver a esa línea.', undefined],
    ['saldo_favor_insuficiente', 'El saldo a favor no alcanza para ese monto.', 'monto'],
    [
      'saldo_favor_pedido_requerido',
      'Los datos del pedido son inconsistentes. Recarga la página.',
      undefined,
    ],
  ])('traduce la regla de pedidos/pagos %s', (constraint, mensaje, campo) => {
    const e = traducirErrorPg(envuelto({ code: 'P0001', constraint }));
    expect(e).toMatchObject({ codigo: constraint, message: mensaje });
    expect(e?.campo).toBe(campo);
  });
  it('toda restricción de datos inconsistentes del pedido tiene mensaje', () => {
    for (const constraint of [
      'pedido_folio_positivo',
      'pedido_tarjeta_coherente',
      'pedido_posicion_rango',
      'pedido_lealtad_pct_rango',
      'pedido_sin_lealtad_coherente',
      'pedido_liquidado_coherente',
      'pedido_item_precios',
      'pedido_item_quitado_coherente',
      'saldo_favor_un_titular',
      'saldo_favor_signo',
      'pago_un_pagador',
    ])
      expect(traducirErrorPg(envuelto({ code: '23514', constraint }))?.message).toBe(
        'Los datos del pedido son inconsistentes. Recarga la página.',
      );
  });
  it.each([
    [
      'pieza_una_ubicacion',
      'Una pieza no puede estar en un exhibidor y con una vendedora a la vez.',
      undefined,
    ],
    [
      'pieza_custodia_solo_si_aplica',
      'Solo una pieza disponible o apartada puede estar con una vendedora.',
      undefined,
    ],
    [
      'pieza_cambio_custodia',
      'La pieza debe estar disponible en Kazero para entregarse, y regresar antes de pasar a otra vendedora.',
      'codigos',
    ],
    ['devolucion_pedido_item_uq', 'Esa pieza ya se devolvió.', undefined],
    ['devolucion_no_es_ultima_venta', 'La pieza no está vendida por este pedido.', undefined],
    [
      'pieza_alta_custodia',
      'Una pieza nueva queda en Kazero: entrégala a la vendedora después del alta.',
      undefined,
    ],
    ['devolucion_pedido_no_liquidado', 'Solo se devuelven piezas de pedidos liquidados.', undefined],
    ['devolucion_linea_no_vigente', 'Esa pieza ya no está en el pedido.', undefined],
    ['devolucion_pieza_no_vendida', 'La pieza no está vendida: no se puede devolver.', undefined],
    [
      'devolucion_excede_linea',
      'La devolución no puede superar lo que costó la pieza en el pedido.',
      undefined,
    ],
    ['devolucion_excede_total', 'Lo devuelto no puede superar el total del pedido.', undefined],
    ['devolucion_fecha', 'La devolución no puede ser anterior a la fecha del pedido.', 'fecha'],
    ['devolucion_monto_positivo', 'El monto debe ser mayor que cero.', undefined],
    ['devolucion_motivo_largo', 'Escribe el motivo de la devolución (hasta 200 caracteres).', 'motivo'],
    ['saldo_favor_retiro_completo', 'El retiro necesita una nota (hasta 200 caracteres).', 'nota'],
    ['saldo_favor_nota_largo', 'La nota admite hasta 200 caracteres.', 'nota'],
    ['pago_saldo_favor_cliente', 'Solo una clienta puede pagar con su saldo a favor.', undefined],
  ])('traduce la regla del Plan 3.1 %s', (constraint, mensaje, campo) => {
    const e = traducirErrorPg(envuelto({ code: 'P0001', constraint }));
    expect(e).toMatchObject({ codigo: constraint, message: mensaje });
    expect(e?.campo).toBe(campo);
  });
  it('las garantías internas del libro de saldo a favor son "datos inconsistentes"', () => {
    for (const constraint of [
      'saldo_favor_signo_v2',
      'saldo_favor_pedido_requerido_v2',
      'saldo_favor_origen',
      'saldo_favor_uso_incoherente',
      'saldo_favor_devolucion_incoherente',
      'saldo_favor_uso_faltante',
      'pago_saldo_sin_aplicacion',
      'devolucion_sin_saldo',
    ])
      expect(traducirErrorPg(envuelto({ code: 'P0001', constraint }))?.message).toBe(
        'Los datos del pedido son inconsistentes. Recarga la página.',
      );
  });
  it('traduce interbloqueos y fallos de serialización', () => {
    for (const code of ['40P01', '40001']) {
      const e = traducirErrorPg(envuelto({ code }));
      expect(e?.codigo).toBe('conflicto_concurrente');
      expect(e?.message).toBe('Otra operación modificó estos datos al mismo tiempo. Intenta de nuevo.');
    }
  });
  it('traduce un uuid inválido como registro no encontrado', () => {
    const e = traducirErrorPg(
      envuelto({ code: '22P02', message: 'invalid input syntax for type uuid: "no-es-uuid"' }),
    );
    expect(e?.codigo).toBe('no_encontrado');
    expect(e?.message).toBe('Registro no encontrado.');
  });
  it('un 22P02 que no es de uuid es un dato inválido, no "no encontrado"', () => {
    const e = traducirErrorPg(
      envuelto({ code: '22P02', message: 'invalid input syntax for type numeric: "abc"' }),
    );
    expect(e?.codigo).toBe('dato_invalido');
    expect(e?.message).toBe('Uno de los datos no tiene un formato válido.');
    expect(traducirErrorPg(envuelto({ code: '22P02' }))?.codigo).toBe('dato_invalido');
  });
  it('no inventa traducciones para errores desconocidos', () => {
    expect(traducirErrorPg(new Error('x'))).toBeNull();
  });
  it('conErroresDeNegocio convierte y relanza', async () => {
    await expect(
      conErroresDeNegocio(async () => {
        throw envuelto({ code: '23505', constraint: 'vendedor_nombre_uq' });
      }),
    ).rejects.toThrow('Ya existe un vendedor con ese nombre.');
  });
});
