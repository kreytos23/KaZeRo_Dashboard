import { describe, expect, it } from 'vitest';
import { ETIQUETA_CAMPO, formatearValor } from '@/features/auditoria/formato';
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
  it('todo campo de dinero tiene etiqueta', () => {
    for (const campos of Object.values(CAMPOS_DINERO))
      for (const c of campos) expect(ETIQUETA_CAMPO[c]).toBeTruthy();
  });
});
