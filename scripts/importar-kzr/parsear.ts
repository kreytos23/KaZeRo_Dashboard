/**
 * Parseo y validación puros de las filas del Excel de notas KZR (sin BD): folio de la nota, tarjeta de
 * lealtad «N dd/mm/aaaa», vendedora «Nelly - Ana», estatus, agrupación por nota y consistencia entre filas.
 */
import { createHash } from 'node:crypto';
import { normalizarCodigo } from '../../src/domain/codigos';
import { parsearFechaISO } from '../../src/domain/fechas';
import { REGLAS_LEALTAD } from '../../src/domain/lealtad';
import { esFolioExplicito, parsearFolio } from '../../src/domain/pedidos';
import { normalizar } from '../../src/domain/texto';
import { jsonCanonico } from '../migrar-excel/ids';
import type { FilaExcel, Problema } from './tipos';

/** «KZR-08» → 8. Solo se acepta con el prefijo KZR (un «8» suelto podría ser otra cosa). */
export function parsearNota(t: string | null): number | null {
  if (!t || !esFolioExplicito(t)) return null;
  return parsearFolio(t);
}

export type ResultadoTarjeta =
  | { ok: true; lugar: number; fecha: string }
  | { ok: false; codigo: 'tarjeta_formato_no_soportado' | 'tarjeta_fecha_futura'; motivo: string };

/** «1 16/09/2026» → lugar 1, fecha 2026-09-16. Cualquier otro formato (p. ej. «1.N») no está soportado aún. */
export function parsearTarjeta(
  t: string | null,
  hoy: string,
  tamanoCiclo = REGLAS_LEALTAD.tamanoCiclo,
): ResultadoTarjeta {
  const noSoportado = (motivo: string): ResultadoTarjeta => ({
    ok: false,
    codigo: 'tarjeta_formato_no_soportado',
    motivo,
  });
  const m = /^(\d{1,2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((t ?? '').trim());
  if (!m) return noSoportado('formato no soportado (se espera «lugar dd/mm/aaaa»)');
  const lugar = Number(m[1]);
  if (lugar < 1 || lugar > tamanoCiclo) return noSoportado(`el lugar debe estar entre 1 y ${tamanoCiclo}`);
  const iso = `${m[4]}-${m[3]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  const fecha = parsearFechaISO(iso);
  if (!fecha) return noSoportado('la fecha no existe en el calendario');
  if (fecha > hoy)
    return { ok: false, codigo: 'tarjeta_fecha_futura', motivo: 'la fecha del pedido no puede ser futura' };
  return { ok: true, lugar, fecha };
}

/** «Nelly - Ana» → vendedora «Nelly» (lo de después es la compradora y se ignora). Sin « - », todo el texto. */
export function partirVendedor(t: string): { vendedora: string; comprador: string | null } {
  const m = /^(.*?)\s+-\s+(.*)$/.exec(t.trim());
  if (!m) return { vendedora: t.trim(), comprador: null };
  return { vendedora: m[1]!.trim(), comprador: m[2]!.trim() || null };
}

export const ESTATUS_SOPORTADOS = ['por cobrar'] as const;
export const esEstatusSoportado = (t: string) =>
  (ESTATUS_SOPORTADOS as readonly string[]).includes(normalizar(t));

/** Iniciales para etiquetar a una persona en el reporte sin volcar su nombre. */
export function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join(' ');
}

/** Parecido (0–1) entre dos descripciones: palabras compartidas / palabras totales (Jaccard). */
export function similitudDescripcion(a: string, b: string): number {
  const palabras = (t: string) =>
    new Set(
      normalizar(t)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 1),
    );
  const [x, y] = [palabras(a), palabras(b)];
  if (!x.size && !y.size) return 1;
  let comunes = 0;
  for (const w of x) if (y.has(w)) comunes++;
  return comunes / (x.size + y.size - comunes);
}

export const UMBRAL_DESCRIPCION = 0.34;

export interface NotaAgrupada {
  folio: number;
  filas: FilaExcel[];
  cliente: string;
  /** Texto completo de «Vendedor» (para la huella) y la vendedora ya separada. */
  vendedorTexto: string;
  vendedora: string;
  tarjeta: string;
  estatus: string;
  codigos: string[];
}

const colapsar = (t: string) => t.trim().replace(/\s+/g, ' ');

/**
 * Agrupa las filas por folio y exige que cada nota sea coherente: mismo cliente, vendedor, tarjeta y estatus
 * en todas sus filas. Los errores no llevan valores (datos personales): solo folio, filas y campo.
 */
export function agruparNotas(filas: readonly FilaExcel[]): { notas: NotaAgrupada[]; errores: Problema[] } {
  const errores: Problema[] = [];
  const grupos = new Map<number, FilaExcel[]>();
  for (const f of filas) {
    const folio = parsearNota(f.nota);
    if (folio === null) {
      errores.push({
        codigo: 'nota_invalida',
        folio: null,
        filas: [f.fila],
        mensaje: 'La «Nota KZR» no tiene el formato KZR-<número>.',
      });
      continue;
    }
    const lista = grupos.get(folio) ?? [];
    lista.push(f);
    grupos.set(folio, lista);
  }
  const notas: NotaAgrupada[] = [];
  for (const [folio, fs] of [...grupos].sort((a, b) => a[0] - b[0])) {
    const nums = fs.map((f) => f.fila);
    const vacios = (['id', 'tarjeta', 'cliente', 'vendedor', 'estatus'] as const).filter((c) =>
      fs.some((f) => !f[c]),
    );
    if (vacios.length) {
      errores.push({
        codigo: 'campo_vacio',
        folio,
        filas: nums,
        mensaje: `Hay celdas vacías en: ${vacios.join(', ')}.`,
      });
      continue;
    }
    const distintos = (clave: (f: FilaExcel) => string) => new Set(fs.map(clave)).size > 1;
    const incoherentes = [
      distintos((f) => normalizar(f.cliente!)) && 'cliente',
      distintos((f) => normalizar(f.vendedor!)) && 'vendedor',
      distintos((f) => colapsar(f.tarjeta!)) && 'tarjeta',
      distintos((f) => normalizar(f.estatus!)) && 'estatus',
    ].filter(Boolean);
    if (incoherentes.length) {
      errores.push({
        codigo: 'nota_inconsistente',
        folio,
        filas: nums,
        mensaje: `Las filas de la nota no coinciden en: ${incoherentes.join(', ')}.`,
      });
      continue;
    }
    const primera = fs[0]!;
    notas.push({
      folio,
      filas: fs,
      cliente: primera.cliente!,
      vendedorTexto: primera.vendedor!,
      vendedora: partirVendedor(primera.vendedor!).vendedora,
      tarjeta: colapsar(primera.tarjeta!),
      estatus: primera.estatus!,
      codigos: fs.map((f) => normalizarCodigo(f.id!)),
    });
  }
  return { notas, errores };
}

/** Huella del contenido del Excel de una nota (sin números de fila): detecta que cambió tras importarse. */
export function hashFuente(n: NotaAgrupada): string {
  return createHash('sha256')
    .update(
      jsonCanonico({
        folio: n.folio,
        cliente: normalizar(n.cliente),
        vendedor: normalizar(n.vendedorTexto),
        tarjeta: n.tarjeta,
        estatus: normalizar(n.estatus),
        codigos: [...n.codigos].sort(),
      }),
    )
    .digest('hex');
}
