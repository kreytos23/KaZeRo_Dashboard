/** Lectura del Excel de tarjetas de lealtad (2026-11-16): una fila por clienta. Solo lee; no valida. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { normalizar } from '../../src/domain/texto';
import { celda } from '../migrar-excel/leer';

export const HOJA_TARJETAS = 'Tarjeta de Lealtad para KZR';
export const ENCABEZADO_TARJETAS = ['Nombre', 'Apellido', '# de compra', 'Vendedor'] as const;

export interface FilaTarjeta {
  fila: number;
  nombre: string | null;
  apellido: string | null;
  compras: string | number | Date | null;
  vendedor: string | null;
}

const texto = (v: ReturnType<typeof celda>) => (v === null ? null : String(v).trim() || null);

export async function leerTarjetasBuffer(buffer: Buffer): Promise<FilaTarjeta[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const hoja = wb.getWorksheet(HOJA_TARJETAS);
  if (!hoja) throw new Error(`Hoja no encontrada: ${HOJA_TARJETAS}`);
  const norm = (r: number, c: number) => normalizar(texto(celda(hoja.getRow(r).getCell(c).value)) ?? '');
  let ini: { fila: number; col: number } | null = null;
  for (let r = 1; r <= Math.min(10, hoja.rowCount) && !ini; r++)
    for (let c = 1; c <= 6 && !ini; c++)
      if (ENCABEZADO_TARJETAS.every((e, i) => norm(r, c + i) === normalizar(e))) ini = { fila: r, col: c };
  if (!ini)
    throw new Error(
      `Encabezado inesperado en ${HOJA_TARJETAS}: se espera ${ENCABEZADO_TARJETAS.join(' | ')}.`,
    );
  const filas: FilaTarjeta[] = [];
  for (let r = ini.fila + 1; r <= hoja.rowCount; r++) {
    const c = ENCABEZADO_TARJETAS.map((_, i) => celda(hoja.getRow(r).getCell(ini.col + i).value));
    if (c.every((x) => x === null)) continue;
    filas.push({
      fila: r,
      nombre: texto(c[0]!),
      apellido: texto(c[1]!),
      compras: c[2]!,
      vendedor: texto(c[3]!),
    });
  }
  return filas;
}

export async function leerTarjetasArchivo(ruta: string): Promise<{ filas: FilaTarjeta[]; sha256: string }> {
  const buffer = await readFile(ruta);
  return {
    filas: await leerTarjetasBuffer(buffer),
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}
