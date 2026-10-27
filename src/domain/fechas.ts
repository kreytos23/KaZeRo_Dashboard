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
