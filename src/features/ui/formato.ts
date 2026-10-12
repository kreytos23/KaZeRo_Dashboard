/** Fecha y hora de negocio para historiales (hora de la Ciudad de México). */
export const FECHA_HORA = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
});
