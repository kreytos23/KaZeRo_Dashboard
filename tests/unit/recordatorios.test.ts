import { describe, expect, it } from 'vitest';
import { proximoReporteDeudores, textoCierre, textoReporteDeudores } from '@/domain/recordatorios';

describe('proximoReporteDeudores', () => {
  it.each([
    ['2026-10-26', '2026-10-26', 0],
    ['2026-10-12', '2026-10-12', 0],
    ['2026-10-27', '2026-11-12', 16],
    ['2026-10-30', '2026-11-12', 13],
    ['2026-10-11', '2026-10-12', 1],
    ['2026-10-13', '2026-10-26', 13],
    ['2026-12-27', '2027-01-12', 16],
  ])('%s → %s (%i días)', (hoy, fecha, dias) => {
    expect(proximoReporteDeudores(hoy)).toEqual({ fecha, dias });
  });
});

describe('textoReporteDeudores', () => {
  it('hoy, mañana y en N días', () => {
    expect(textoReporteDeudores('2026-10-26')).toBe('Hoy toca el reporte de deudores.');
    expect(textoReporteDeudores('2026-10-27')).toBe(
      'Próximo reporte de deudores: 12 de noviembre (en 16 días).',
    );
    expect(textoReporteDeudores('2026-10-11')).toBe('Próximo reporte de deudores: mañana, 12 de octubre.');
  });
});

describe('textoCierre', () => {
  it('mes en curso aún no cerrable', () => {
    expect(textoCierre('2026-10-01', '2026-10-27')).toEqual({
      texto: 'Octubre 2026 se podrá cerrar desde el 1 de noviembre.',
      cerrable: false,
    });
  });
  it('mes ya cerrable', () => {
    expect(textoCierre('2026-09-01', '2026-10-27')).toEqual({
      texto: 'Septiembre 2026 ya se puede cerrar.',
      cerrable: true,
    });
  });
});
