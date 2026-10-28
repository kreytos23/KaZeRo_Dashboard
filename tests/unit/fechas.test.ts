import { describe, expect, it } from 'vitest';
import { diasEntre, hoyMX, parsearFechaISO, saludoSegunHora } from '@/domain/fechas';

describe('fechas de negocio', () => {
  it('acepta fechas reales', () => {
    expect(parsearFechaISO('2026-02-28')).toBe('2026-02-28');
    expect(parsearFechaISO('2028-02-29')).toBe('2028-02-29');
  });
  it.each(['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', ''])(
    'rechaza %j (una regex no valida un calendario)',
    (t) => expect(parsearFechaISO(t)).toBeNull(),
  );
  it('hoy se calcula en hora de la Ciudad de México', () => {
    // 2026-10-09 03:00 UTC sigue siendo el 8 de octubre en CDMX (UTC-6).
    expect(hoyMX(new Date('2026-10-09T03:00:00Z'))).toBe('2026-10-08');
  });
});

describe('diasEntre', () => {
  it('cuenta días de calendario, con signo y a través de meses', () => {
    expect(diasEntre('2026-10-12', '2026-10-26')).toBe(14);
    expect(diasEntre('2026-10-26', '2026-10-12')).toBe(-14);
    expect(diasEntre('2026-10-26', '2026-11-12')).toBe(17);
    expect(diasEntre('2026-03-07', '2026-03-09')).toBe(2);
  });
});

describe('saludoSegunHora (hora de México, UTC-6 todo el año)', () => {
  it.each([
    ['2026-10-09T06:00:00Z', 'Buenos días'], // 00:00 en CDMX
    ['2026-10-09T17:59:00Z', 'Buenos días'], // 11:59
    ['2026-10-09T18:00:00Z', 'Buenas tardes'], // 12:00
    ['2026-10-10T00:59:00Z', 'Buenas tardes'], // 18:59
    ['2026-10-10T01:00:00Z', 'Buenas noches'], // 19:00
    ['2026-10-10T05:59:00Z', 'Buenas noches'], // 23:59
    // 03:00 UTC es aún la noche anterior en CDMX (21:00), no la madrugada.
    ['2026-10-09T03:00:00Z', 'Buenas noches'],
  ])('%s → %s', (iso, esperado) => expect(saludoSegunHora(new Date(iso))).toBe(esperado));
});
