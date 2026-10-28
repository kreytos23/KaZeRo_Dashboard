/** Fecha y hora de negocio para historiales (hora de la Ciudad de México). */
export const FECHA_HORA = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
});

/** «lunes, 12 de octubre de 2026» a partir de una fecha de negocio en UTC (`new Date('AAAA-MM-DDT12:00:00Z')`). */
export const FECHA_LARGA = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'UTC' });
