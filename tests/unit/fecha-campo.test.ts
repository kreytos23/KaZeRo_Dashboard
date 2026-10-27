import { describe, expect, it } from 'vitest';
import {
  dateAIso,
  enmascararFecha,
  errorDeFecha,
  isoADate,
  isoAVista,
  normalizarVista,
  vistaAIso,
} from '@/features/ui/fecha-campo';

describe('isoAVista / vistaAIso', () => {
  it('convierte entre aaaa-mm-dd y dd/mm/aaaa', () => {
    expect(isoAVista('2026-10-12')).toBe('12/10/2026');
    expect(vistaAIso('12/10/2026')).toBe('2026-10-12');
  });
  it('acepta día y mes con una cifra', () => {
    expect(vistaAIso('5/1/2026')).toBe('2026-01-05');
  });
  it('rechaza fechas que no existen en el calendario', () => {
    expect(vistaAIso('30/02/2026')).toBeNull();
    expect(vistaAIso('31/04/2026')).toBeNull();
    expect(vistaAIso('29/02/2028')).toBe('2028-02-29');
    expect(vistaAIso('29/02/2026')).toBeNull();
  });
  it('rechaza texto incompleto o con otro formato', () => {
    expect(vistaAIso('')).toBeNull();
    expect(vistaAIso('12/10')).toBeNull();
    expect(vistaAIso('2026-10-12')).toBeNull();
    expect(isoAVista('')).toBe('');
    expect(isoAVista('basura')).toBe('');
  });
});

describe('enmascararFecha', () => {
  it('pone las diagonales mientras se escriben solo dígitos', () => {
    expect(enmascararFecha('1')).toBe('1');
    expect(enmascararFecha('12')).toBe('12');
    expect(enmascararFecha('121')).toBe('12/1');
    expect(enmascararFecha('1210')).toBe('12/10');
    expect(enmascararFecha('12102')).toBe('12/10/2');
    expect(enmascararFecha('12102026')).toBe('12/10/2026');
  });
  it('limita a ocho dígitos y descarta letras', () => {
    expect(enmascararFecha('121020261234')).toBe('12/10/2026');
    expect(enmascararFecha('1a2b')).toBe('12');
  });
  it('respeta los separadores que escribe la persona (día de una cifra)', () => {
    expect(enmascararFecha('5/10/2026')).toBe('5/10/2026');
    expect(enmascararFecha('5-10-2026')).toBe('5/10/2026');
    expect(enmascararFecha('5//10')).toBe('5/10');
  });
  it('convierte un ISO pegado', () => {
    expect(enmascararFecha('2026-10-12')).toBe('12/10/2026');
  });
  it('al borrar una diagonal no se atasca', () => {
    expect(enmascararFecha('12/')).toBe('12/');
    expect(enmascararFecha('12')).toBe('12');
  });
});

describe('normalizarVista', () => {
  it('completa los ceros de una fecha válida', () => {
    expect(normalizarVista('5/1/2026')).toBe('05/01/2026');
  });
  it('deja intacto lo que no es una fecha', () => {
    expect(normalizarVista('12/1')).toBe('12/1');
    expect(normalizarVista('')).toBe('');
  });
});

describe('errorDeFecha', () => {
  it('vacío no es error (lo cubre required)', () => {
    expect(errorDeFecha('')).toBe('');
  });
  it('pide la fecha completa', () => {
    expect(errorDeFecha('12/10')).toMatch(/dd\/mm\/aaaa/);
    expect(errorDeFecha('31/02/2026')).toMatch(/dd\/mm\/aaaa/);
  });
  it('respeta mínimo y máximo, mostrándolos como dd/mm/aaaa', () => {
    expect(errorDeFecha('01/01/2020', '2026-01-01')).toBe('La fecha no puede ser anterior al 01/01/2026.');
    expect(errorDeFecha('02/01/2027', undefined, '2026-12-31')).toBe(
      'La fecha no puede ser posterior al 31/12/2026.',
    );
    expect(errorDeFecha('15/06/2026', '2026-01-01', '2026-12-31')).toBe('');
  });
});

describe('isoADate / dateAIso', () => {
  it('ida y vuelta sin saltos de día', () => {
    for (const iso of ['2026-01-01', '2026-03-08', '2026-10-25', '2028-02-29', '2026-12-31']) {
      expect(dateAIso(isoADate(iso)!)).toBe(iso);
    }
  });
  it('un ISO inválido no da fecha', () => {
    expect(isoADate('2026-02-30')).toBeUndefined();
    expect(isoADate('')).toBeUndefined();
  });
});
