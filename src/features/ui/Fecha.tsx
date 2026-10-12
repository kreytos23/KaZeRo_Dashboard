import { FECHA_HORA } from './formato';

/** Fecha y hora de negocio como `<time>`; un valor ilegible se muestra como "—" en vez de romper la ficha. */
export function Fecha({ fecha }: { fecha: Date }) {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) return <span>—</span>;
  return <time dateTime={fecha.toISOString()}>{FECHA_HORA.format(fecha)}</time>;
}
