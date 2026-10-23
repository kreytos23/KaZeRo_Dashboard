import { esCodigoValido, normalizarCodigo } from '../../src/domain/codigos';
import { pesosACentavos } from '../../src/domain/dinero';
import { parsearFechaISO } from '../../src/domain/fechas';
import { normalizar } from '../../src/domain/texto';
import { llaveNombre } from './llave';
import type { Celda, ClaseEstatus, MapeoNormalizacion } from './tipos';

export { llaveNombre };

const pad = (n: number) => String(n).padStart(2, '0');

/** M-01: monto de una celda en centavos; negativos, NaN o más de 2 decimales → null. */
export function centavosDeCelda(c: Celda): number | null {
  if (typeof c === 'number') {
    if (!Number.isFinite(c) || c < 0) return null;
    const x = Math.round(c * 100);
    return Math.abs(x - c * 100) < 1e-6 && Number.isSafeInteger(x) ? x : null;
  }
  return typeof c === 'string' ? pesosACentavos(c) : null;
}

/** M-02: código de pieza de una celda (texto o entero), normalizado y válido; si no, null. */
export function codigoDeCelda(c: Celda): string | null {
  let t: string;
  if (typeof c === 'string') t = c;
  else if (typeof c === 'number' && Number.isInteger(c)) t = String(c);
  else return null;
  const n = normalizarCodigo(t);
  return esCodigoValido(n) ? n : null;
}

/** M-03: código de pieza histórica único (`H-<c>`, `H-<c>-2`…; sin código o muy largo → `H-F<fila>`). */
export function codigoHistorico(codigo: string | null, fila: number, usados: Set<string>): string {
  const base = codigo && codigo.length <= 15 ? `H-${codigo}` : `H-F${fila}`;
  let c = base;
  for (let n = 2; usados.has(c); n++) c = `${base}-${n}`;
  if (!esCodigoValido(c)) throw new RangeError(`Código histórico inválido: ${c}`);
  usados.add(c);
  return c;
}

/** M-05: separa "<prefijo> - <nombre>" (solo el primer " - "); el prefijo es vendedor si es alias conocido. */
export function separarPrefijo(
  t: string,
  alias: ReadonlyMap<string, string>,
): { nombre: string; vendedor: string | null; referencia: string | null } {
  const texto = t.trim();
  const i = texto.indexOf(' - ');
  if (i < 0) return { nombre: texto, vendedor: null, referencia: null };
  const izq = texto.slice(0, i).trim();
  const nombre = texto.slice(i + 3).trim();
  if (!izq || !nombre) return { nombre: texto, vendedor: null, referencia: null };
  const vendedor = alias.get(llaveNombre(izq)) ?? null;
  return { nombre, vendedor, referencia: vendedor ? null : izq };
}

/** M-06: fecha ISO (UTC) de una celda Date con año ≥ 2000 y ≤ corte; si no, null. */
export function fechaDeCelda(c: Celda, corte: string): string | null {
  if (!(c instanceof Date) || Number.isNaN(c.getTime())) return null;
  if (c.getUTCFullYear() < 2000) return null;
  const iso = `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`;
  return iso <= corte ? iso : null;
}

const MESES: Record<string, number> = {
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agos: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  setiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
};
const NOMBRES_MES = Object.keys(MESES)
  .sort((a, b) => b.length - a.length)
  .join('|');
const PATRON_DM = new RegExp(`(?<![\\p{L}\\d])(\\d{1,2})\\s?(${NOMBRES_MES})(?![\\p{L}\\d])`, 'gu');

/** M-07: fechas "dd-mes" sin año en un comentario (en orden de aparición). */
export function fechasDeComentario(t: string): { dia: number; mes: number }[] {
  const salida: { dia: number; mes: number }[] = [];
  for (const m of normalizar(t).matchAll(PATRON_DM)) {
    const dia = Number(m[1]);
    if (dia >= 1 && dia <= 31) salida.push({ dia, mes: MESES[m[2]!]! });
  }
  return salida;
}

/** M-08: completa el año de una fecha sin año; null si el calendario no la admite. */
export function inferirFecha(
  dm: { dia: number; mes: number },
  o: { desde: string | null; hasta: string },
): string | null {
  const anioHasta = Number(o.hasta.slice(0, 4));
  const validas: string[] = [];
  for (let a = anioHasta - 5; a <= anioHasta; a++) {
    const f = parsearFechaISO(`${a}-${pad(dm.mes)}-${pad(dm.dia)}`);
    if (f && f <= o.hasta && (!o.desde || f >= o.desde)) validas.push(f);
  }
  return (o.desde ? validas[0] : validas.at(-1)) ?? null;
}

export type TarjetaParseada =
  { posicion: number; ciclo: number | null; fecha: string | null; tbd: boolean } | { etiqueta: string };

/** M-09: celda de la columna "Tarjeta de Lealtad" del Concentrado. */
export function parsearTarjeta(c: Celda): TarjetaParseada | null {
  if (c == null) return null;
  const t = String(c).trim().replace(/['’]/g, '');
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?\s+(?:(\d{1,2})\/(\d{1,2}|[a-z]{3,4})\/(\d{2,4})|(TBD))$/i.exec(t);
  if (!m) return /\d/.test(t) ? null : { etiqueta: t };
  const ciclo = m[2] ? Number(m[1]) : null;
  const posicion = Number(m[2] ?? m[1]);
  if (posicion < 1 || posicion > 10) return null;
  if (m[6]) return { posicion, ciclo, fecha: null, tbd: true };
  const mes = /^\d+$/.test(m[4]!) ? Number(m[4]) : MESES[m[4]!.toLowerCase()];
  const anio = m[5]!.length === 2 ? 2000 + Number(m[5]) : Number(m[5]);
  const fecha = mes ? parsearFechaISO(`${anio}-${pad(mes)}-${pad(Number(m[3]))}`) : null;
  return { posicion, ciclo, fecha, tbd: false };
}

/** M-10: último "RESTA <monto>" de un comentario, en centavos. */
export function restaDeComentario(t: string): number | null {
  const todos = [...t.matchAll(/resta\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/gi)];
  const ultimo = todos.at(-1);
  return ultimo ? pesosACentavos(`${ultimo[1]}${ultimo[2] ?? ''}`) : null;
}

/** M-11: clase de un estatus según el mapeo (por llave normalizada); null = sin clasificar. */
export function clasificarEstatus(t: Celda, m: MapeoNormalizacion): ClaseEstatus | null {
  if (typeof t !== 'string') return null;
  return m.estatus[llaveNombre(t)] ?? null;
}

/** M-12: proveedor canónico; números o direcciones no son proveedores (null + aviso). */
export function proveedorCanonico(
  t: Celda,
  m: MapeoNormalizacion,
): { nombre: string | null; aviso: string | null } {
  if (t == null) return { nombre: null, aviso: null };
  const texto = t instanceof Date ? '' : String(t).trim();
  if (!texto) return { nombre: null, aviso: null };
  const pareceDireccion =
    /^[\d\s.,#-]+$/.test(texto) ||
    (/\d/.test(texto) &&
      /(^|[^\p{L}])(calle|av|avenida|blvd|col|colonia|cp|c\.p|num|piso|local)([^\p{L}]|$)|#/iu.test(texto));
  if (typeof t === 'number' || t instanceof Date || pareceDireccion) {
    return { nombre: null, aviso: `Proveedor descartado (número o dirección): ${texto}` };
  }
  const llave = llaveNombre(texto);
  return { nombre: llave in m.proveedores ? (m.proveedores[llave] ?? null) : texto, aviso: null };
}

/** M-13: categoría de una pieza histórica por la primera palabra de su descripción (en singular). */
export function categoriaDeDescripcion(d: string, m: MapeoNormalizacion): string {
  const palabra = llaveNombre(d).split(' ')[0] ?? '';
  if (!palabra) return m.categoriaSinDato;
  const candidatos = [palabra, palabra.replace(/s$/, ''), palabra.replace(/es$/, '')];
  for (const c of candidatos) {
    const hit = m.categoriasPorPalabra[c];
    if (hit) return hit;
  }
  return m.categoriaSinDato;
}

/** M-14: palabras de 3+ letras compartidas entre dos nombres / mínimo de palabras de ambos. */
export function similitud(a: string, b: string): number {
  const palabras = (t: string) =>
    new Set(
      llaveNombre(t)
        .split(' ')
        .filter((p) => p.length >= 3),
    );
  const pa = palabras(a);
  const pb = palabras(b);
  const min = Math.min(pa.size, pb.size);
  if (min === 0) return 0;
  let comunes = 0;
  for (const p of pa) if (pb.has(p)) comunes++;
  return comunes / min;
}
