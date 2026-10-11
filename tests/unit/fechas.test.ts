import { describe, expect, it } from 'vitest';
import { hoyMX, parsearFechaISO } from '@/domain/fechas';

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
