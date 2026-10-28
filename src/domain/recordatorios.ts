import { MESES, mesCerrable, mesSiguiente, nombreMes } from './comisiones';
import { diasEntre } from './fechas';

const diaMes = (iso: string) =>
  `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]!.toLowerCase()}`;

/** El reporte de deudores toca los días 12 y 26 de cada mes (hoy cuenta si coincide). */
export function proximoReporteDeudores(hoy: string): { fecha: string; dias: number } {
  const dia = Number(hoy.slice(8, 10));
  const fecha =
    dia <= 12
      ? `${hoy.slice(0, 7)}-12`
      : dia <= 26
        ? `${hoy.slice(0, 7)}-26`
        : `${mesSiguiente(`${hoy.slice(0, 7)}-01`).slice(0, 7)}-12`;
  return { fecha, dias: diasEntre(hoy, fecha) };
}

export function textoReporteDeudores(hoy: string): string {
  const { fecha, dias } = proximoReporteDeudores(hoy);
  if (dias === 0) return 'Hoy toca el reporte de deudores.';
  if (dias === 1) return `Próximo reporte de deudores: mañana, ${diaMes(fecha)}.`;
  return `Próximo reporte de deudores: ${diaMes(fecha)} (en ${dias} días).`;
}

export function textoCierre(abierto: string, hoy: string): { texto: string; cerrable: boolean } {
  const nombre = nombreMes(abierto);
  if (mesCerrable(abierto, hoy)) return { texto: `${nombre} ya se puede cerrar.`, cerrable: true };
  return { texto: `${nombre} se podrá cerrar desde el ${diaMes(mesSiguiente(abierto))}.`, cerrable: false };
}
