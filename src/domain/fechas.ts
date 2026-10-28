/** Valida contra el calendario real, no solo el formato: '2026-02-30' se rechaza (lecciones §2). */
export function parsearFechaISO(t: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, me - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === me - 1 && f.getUTCDate() === d ? m[0] : null;
}

/** '2026-10-12' → '12/10/2026' (fecha de negocio, sin zona horaria). */
export function fechaCorta(iso: string): string {
  return iso.split('-').reverse().join('/');
}

const DIA_MX = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' });

/** Fecha de negocio de hoy (YYYY-MM-DD) en la zona horaria del negocio. */
export function hoyMX(ahora = new Date()): string {
  return DIA_MX.format(ahora);
}

const HORA_MX = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Mexico_City',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Saludo del inicio según la hora en México: 00:00-11:59, 12:00-18:59 y 19:00-23:59. */
export function saludoSegunHora(ahora: Date): 'Buenos días' | 'Buenas tardes' | 'Buenas noches' {
  const h = Number(HORA_MX.format(ahora));
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

/** Días de calendario de `a` a `b` (fechas de negocio 'AAAA-MM-DD'; negativo si `b` es anterior). */
export function diasEntre(a: string, b: string): number {
  const utc = (iso: string) =>
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}
