import { describe, expect, it } from 'vitest';
import { ETIQUETA_CAMPO, formatearValor, textoCambio } from '@/features/auditoria/formato';
import { CAMPOS_DINERO } from '@/domain/auditoria';

describe('formato del historial de cambios', () => {
  it('montos en pesos, comisión en %, activo como Sí/No y vacíos como guion', () => {
    expect(formatearValor('precio', '1234.50')).toBe('$1,234.50');
    expect(formatearValor('costo', '0.00')).toBe('$0.00');
    expect(formatearValor('comision_pct', '18.00')).toBe('18 %');
    expect(formatearValor('comision_pct', '12.50')).toBe('12.5 %');
    expect(formatearValor('activo', 'false')).toBe('No');
    expect(formatearValor('tipo', 'consignacion')).toBe('Negocio a consignación');
    expect(formatearValor('telefono', null)).toBe('—');
    expect(formatearValor('notas', '')).toBe('—');
    expect(formatearValor('nombre', 'Oro laminado')).toBe('Oro laminado');
  });
  it('un monto histórico ilegible o enorme se muestra tal cual, sin lanzar', () => {
    expect(formatearValor('precio', 'abc')).toBe('abc');
    expect(formatearValor('costo', '-5.00')).toBe('-5.00');
    expect(formatearValor('precio', '99999999999999999999')).toBe('99999999999999999999');
  });
  it('campos de pedido: total y descuento manual en pesos, con etiqueta', () => {
    expect(formatearValor('total', '1490.00')).toBe('$1,490.00');
    expect(formatearValor('descuento_manual_monto', '10.00')).toBe('$10.00');
    for (const c of ['fecha', 'estado', 'vendedor', 'descuento_manual_motivo', 'total', 'cancelacion_motivo'])
      expect(ETIQUETA_CAMPO[c]).toBeTruthy();
    expect(CAMPOS_DINERO.pedido).toEqual(['total', 'descuento_manual_monto']);
  });
  it('todo campo de dinero tiene etiqueta', () => {
    for (const campos of Object.values(CAMPOS_DINERO))
      for (const c of campos) expect(ETIQUETA_CAMPO[c]).toBeTruthy();
  });
});

describe('textoCambio: la foto no muestra uuids (D8)', () => {
  it.each([
    [null, 'a1', 'agregada'],
    ['a1', 'b2', 'cambiada'],
    ['a1', null, 'quitada'],
  ] as const)('%s → %s: %s', (antes, despues, texto) => {
    expect(textoCambio('imagen_clave', antes, despues)).toBe(texto);
  });
  it('los demás campos siguen como "antes → después"', () => {
    expect(textoCambio('precio', '149.00', '199.00')).toBe('$149.00 → $199.00');
    expect(textoCambio('material', null, 'Plata')).toBe('— → Plata');
  });
  it('la foto tiene etiqueta', () => {
    expect(ETIQUETA_CAMPO.imagen_clave).toBe('Foto');
  });
});
