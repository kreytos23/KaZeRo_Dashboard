/** Lectura del Excel de notas KZR: hoja «Hoja1», una fila por pieza. Solo lee; no valida el contenido. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { normalizar } from '../../src/domain/texto';
import { celda } from '../migrar-excel/leer';
import { HOJA_KZR, type FilaExcel } from './tipos';

export const ENCABEZADO = [
  'Nota KZR',
  'ID',
  'Descripción',
  'Tarjeta de Lealtad',
  'Cliente',
  'Vendedor',
  'Estatus',
] as const;

/** Texto recortado de una celda; una fecha de Excel no es el formato esperado y se marca como tal. */
function texto(v: ReturnType<typeof celda>): string | null {
  if (v === null) return null;
  const t = v instanceof Date ? `[fecha de Excel ${v.toISOString().slice(0, 10)}]` : String(v);
  return t.trim() === '' ? null : t.trim();
}

export async function leerFilasBuffer(buffer: Buffer): Promise<FilaExcel[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const hoja = wb.getWorksheet(HOJA_KZR);
  if (!hoja) throw new Error(`Hoja no encontrada: ${HOJA_KZR}`);
  // El encabezado puede no estar en A1 (p. ej. columna A vacía): se busca «Nota KZR» en las primeras filas.
  const celdaNorm = (r: number, c: number) => normalizar(texto(celda(hoja.getRow(r).getCell(c).value)) ?? '');
  let ini: { fila: number; col: number } | null = null;
  for (let r = 1; r <= Math.min(10, hoja.rowCount) && !ini; r++)
    for (let c = 1; c <= 6 && !ini; c++)
      if (celdaNorm(r, c) === normalizar(ENCABEZADO[0]))
        if (ENCABEZADO.every((e, i) => celdaNorm(r, c + i) === normalizar(e))) ini = { fila: r, col: c };
  if (!ini) throw new Error(`Encabezado inesperado en ${HOJA_KZR}: se espera ${ENCABEZADO.join(' | ')}.`);
  const filas: FilaExcel[] = [];
  for (let r = ini.fila + 1; r <= hoja.rowCount; r++) {
    const c = ENCABEZADO.map((_, i) => texto(celda(hoja.getRow(r).getCell(ini.col + i).value)));
    if (c.every((x) => x === null)) continue;
    filas.push({
      fila: r,
      nota: c[0]!,
      id: c[1]!,
      descripcion: c[2]!,
      tarjeta: c[3]!,
      cliente: c[4]!,
      vendedor: c[5]!,
      estatus: c[6]!,
    });
  }
  return filas;
}

export async function leerFilasArchivo(ruta: string): Promise<{ filas: FilaExcel[]; sha256: string }> {
  const buffer = await readFile(ruta);
  return {
    filas: await leerFilasBuffer(buffer),
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}
