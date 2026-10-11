import { describe, expect, it } from 'vitest';
import {
  centavosANumeric,
  formatoMXN,
  numericACentavos,
  pesosACentavos,
  porcentajeANumeric,
} from '@/domain/dinero';

describe('dinero en centavos', () => {
  it.each([
    ['149', 14900],
    ['149.5', 14950],
    ['$1,234.50', 123450],
    [' 0 ', 0],
  ])('pesosACentavos(%j) = %d', (t, c) => expect(pesosACentavos(t)).toBe(c));
  it.each(['', 'abc', '-5', '1.234', '1,2,3.4.5'])('rechaza %j', (t) => expect(pesosACentavos(t)).toBeNull());
  it('ida y vuelta con numeric de Postgres sin flotantes', () => {
    expect(centavosANumeric(123450)).toBe('1234.50');
    expect(centavosANumeric(5)).toBe('0.05');
    expect(numericACentavos('1234.50')).toBe(123450);
    expect(numericACentavos('7')).toBe(700);
  });
  it('formatea en pesos mexicanos', () => {
    expect(formatoMXN(123450)).toBe('$1,234.50');
  });
  it('porcentaje de comisión de 0 a 100 con 2 decimales', () => {
    expect(porcentajeANumeric('18')).toBe('18.00');
    expect(porcentajeANumeric('15.5%')).toBe('15.50');
    expect(porcentajeANumeric('101')).toBeNull();
    expect(porcentajeANumeric('-1')).toBeNull();
  });
});
