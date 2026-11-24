import { describe, expect, it } from 'vitest';
import { diasEntre, fechaLarga, hoyMX, parsearFechaISO, saludoSegunHora, sumarMeses } from '@/domain/fechas';

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

describe("sumarMeses (igual que `fecha + interval 'n months'` de Postgres)", () => {
  it.each([
    ['2026-05-17', 6, '2026-11-17'], // mismo día
    ['2026-08-31', 6, '2027-02-28'], // febrero no tiene 31: último día del mes
    ['2027-08-31', 6, '2028-02-29'], // año bisiesto
    ['2026-08-30', 6, '2027-02-28'],
    ['2028-02-29', 6, '2028-08-29'],
    ['2026-03-31', 6, '2026-09-30'], // septiembre tiene 30
    ['2026-07-15', 6, '2027-01-15'], // cruza el año
    ['2026-12-31', 6, '2027-06-30'],
    ['2026-01-31', 1, '2026-02-28'],
  ])('%s + %i meses = %s', (iso, meses, esperado) => expect(sumarMeses(iso, meses)).toBe(esperado));
  it('suma los meses de una vez y recorta al final: 31 oct + 6 = 30 abr (no recorta en febrero)', () => {
    expect(sumarMeses('2026-10-31', 6)).toBe('2027-04-30');
    expect(sumarMeses('2026-08-31', 7)).toBe('2027-03-31');
  });
});

describe('fechaLarga', () => {
  it.each([
    ['2026-11-24', '24 de noviembre de 2026'],
    ['2026-01-01', '1 de enero de 2026'],
    ['2027-12-31', '31 de diciembre de 2027'],
  ])('%s → %s', (iso, esperado) => expect(fechaLarga(iso)).toBe(esperado));
  it('sirve con la fecha de negocio de hoy en México', () => {
    // 2026-11-25 03:00 UTC aún es el 24 de noviembre en CDMX.
    expect(fechaLarga(hoyMX(new Date('2026-11-25T03:00:00Z')))).toBe('24 de noviembre de 2026');
  });
});
