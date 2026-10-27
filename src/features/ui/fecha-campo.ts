import { parsearFechaISO } from '@/domain/fechas';

/**
 * Lógica pura del campo de fecha de escritorio (CampoFecha): el negocio guarda fechas ISO (aaaa-mm-dd) y la
 * persona las lee y escribe como dd/mm/aaaa. Nada aquí usa zonas horarias: solo texto y calendario.
 */

const VISTA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** '2026-10-12' → '12/10/2026'; un valor vacío o inválido da ''. */
export function isoAVista(iso: string): string {
  const ok = parsearFechaISO(iso);
  if (!ok) return '';
  const [a, m, d] = ok.split('-');
  return `${d}/${m}/${a}`;
}

/** '12/10/2026' (día y mes pueden ir con una cifra) → '2026-10-12'; null si no es una fecha real del calendario. */
export function vistaAIso(texto: string): string | null {
  const m = VISTA.exec(texto.trim());
  if (!m) return null;
  return parsearFechaISO(`${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`);
}

/**
 * Máscara mientras se escribe: solo dígitos, y las diagonales se ponen solas (1210 → 12/10, 12102026 →
 * 12/10/2026). Si la persona ya escribe separadores (5/10/2026) se respetan; un ISO pegado se convierte.
 */
export function enmascararFecha(entrada: string): string {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(entrada);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/[/\-. ]/.test(entrada.trim())) {
    return entrada
      .replace(/[-. ]/g, '/')
      .replace(/[^\d/]/g, '')
      .replace(/\/{2,}/g, '/')
      .slice(0, 10);
  }
  const d = entrada.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** Al salir del campo: una fecha válida se reescribe con dos cifras (5/1/2026 → 05/01/2026). */
export function normalizarVista(texto: string): string {
  const iso = vistaAIso(texto);
  return iso ? isoAVista(iso) : texto;
}

/** Mensaje para el navegador (setCustomValidity) o '' si el texto es válido y está dentro del rango. */
export function errorDeFecha(texto: string, min?: string, max?: string): string {
  const t = texto.trim();
  if (!t) return '';
  const iso = vistaAIso(t);
  if (!iso) return 'Escribe una fecha completa con el formato dd/mm/aaaa.';
  if (min && iso < min) return `La fecha no puede ser anterior al ${isoAVista(min)}.`;
  if (max && iso > max) return `La fecha no puede ser posterior al ${isoAVista(max)}.`;
  return '';
}

/** Fecha local a mediodía (evita saltos de día por horario de verano o zona) para el calendario. */
export function isoADate(iso: string): Date | undefined {
  const ok = parsearFechaISO(iso);
  if (!ok) return undefined;
  const [a, m, d] = ok.split('-').map(Number);
  return new Date(a!, m! - 1, d!, 12);
}

/** Día elegido en el calendario (local) → 'aaaa-mm-dd'. */
export function dateAIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${mm}-${dd}`;
}
