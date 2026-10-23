import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { normalizar } from '../../src/domain/texto';
import { llaveNombre } from './llave';
import type {
  Celda,
  FilaConcentrado,
  FilaCumple,
  FilaHojaExhibidor,
  FilaInventario,
  FilaLealtad,
  Libro,
} from './tipos';

/** Limpia el valor de una celda de exceljs: fórmulas → resultado, richText → texto, errores → null. */
export function celda(v: ExcelJS.CellValue | undefined): Celda {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return String(v);
  if ('richText' in v) return celda(v.richText.map((t) => t.text).join(''));
  if ('result' in v) return celda((v.result ?? null) as ExcelJS.CellValue); // fórmula
  if ('text' in v) return celda(v.text as string); // hipervínculo
  return null; // error (#N/A…) u objeto desconocido
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function hojaDe(wb: ExcelJS.Workbook, nombre: string): ExcelJS.Worksheet {
  const h = wb.getWorksheet(nombre);
  if (!h) throw new Error(`Hoja no encontrada: ${nombre}`);
  return h;
}

function exigirEncabezado(hoja: ExcelJS.Worksheet, fila: number, desde: number, esperado: string[]) {
  const real = esperado.map((_, i) =>
    normalizar(String(celda(hoja.getRow(fila).getCell(desde + i).value) ?? '')),
  );
  const ok = esperado.every((e, i) => real[i] === normalizar(e));
  if (!ok) throw new Error(`Encabezado inesperado en ${hoja.name}: ${real.join(' | ')}`);
}

/** Celdas `desde..desde+n-1` de la fila; null si la fila no tiene ningún dato. */
function leerFila(row: ExcelJS.Row, desde: number, n: number): Celda[] | null {
  const c = Array.from({ length: n }, (_, i) => celda(row.getCell(desde + i).value));
  return c.every((x) => x === null) ? null : c;
}

function recorrer<T>(
  hoja: ExcelJS.Worksheet,
  primera: number,
  desde: number,
  n: number,
  armar: (c: Celda[], fila: number) => T,
): T[] {
  const salida: T[] = [];
  for (let r = primera; r <= hoja.rowCount; r++) {
    const c = leerFila(hoja.getRow(r), desde, n);
    if (c) salida.push(armar(c, r));
  }
  return salida;
}

export async function leerLibros(o: {
  inventario: Buffer;
  tracking: Buffer;
  hojasExhibidor: string[];
}): Promise<Libro> {
  const wbInv = new ExcelJS.Workbook();
  await wbInv.xlsx.load(o.inventario as unknown as ArrayBuffer);
  const wbTr = new ExcelJS.Workbook();
  await wbTr.xlsx.load(o.tracking as unknown as ArrayBuffer);

  const hInv = hojaDe(wbInv, 'INVENTARIO');
  exigirEncabezado(hInv, 1, 1, [
    'ID',
    'Categoria',
    'Producto',
    'Material',
    'Proveedor',
    'Costo',
    'P. Venta',
    'Ex',
    'Ubicacion',
    'Cliente',
    'Vendedor',
  ]);
  const inventario = recorrer<FilaInventario>(hInv, 2, 1, 11, (c, fila) => ({
    fila,
    id: c[0]!,
    categoria: c[1]!,
    producto: c[2]!,
    material: c[3]!,
    proveedor: c[4]!,
    costo: c[5]!,
    precio: c[6]!,
    ubicacion: c[8]!,
    cliente: c[9]!,
    vendedor: c[10]!,
  }));

  const hConc = hojaDe(wbTr, 'Concentrado joyeria_agos');
  exigirEncabezado(hConc, 2, 1, [
    'Fecha de compra',
    'Costo de joyeria',
    'Costo de venta',
    'Cliente',
    'Estatus',
    'Ganancia',
    'ID',
    'Descripción',
    'Comentarios',
    'Comisión',
    'Proveedor',
    'Tarjeta de Lealtad',
    'Nota KZR',
  ]);
  const concentrado = recorrer<FilaConcentrado>(hConc, 3, 1, 13, (c, fila) => ({
    fila,
    fechaCompra: c[0]!,
    costo: c[1]!,
    venta: c[2]!,
    cliente: c[3]!,
    estatus: c[4]!,
    id: c[6]!,
    descripcion: c[7]!,
    comentarios: c[8]!,
    comision: c[9]!,
    proveedor: c[10]!,
    tarjeta: c[11]!,
    nota: c[12]!,
  }));

  const hLeal = hojaDe(wbTr, 'Tarjeta de Lealtad');
  exigirEncabezado(hLeal, 3, 2, ['Clientx']);
  const lealtad = recorrer<FilaLealtad>(hLeal, 4, 2, 11, (c, fila) => ({
    fila,
    cliente: c[0]!,
    celdas: c.slice(1),
  }));

  const hCumple = hojaDe(wbTr, 'Cumpleaños ');
  exigirEncabezado(hCumple, 2, 2, ['Red social', 'Nombre', 'Fecha']);
  exigirEncabezado(hCumple, 2, 8, ['Nombre', 'Fecha']);
  const cumpleanos: FilaCumple[] = [
    ...recorrer<FilaCumple>(hCumple, 3, 2, 3, (c, fila) => ({
      fila,
      bloque: 'A',
      red: c[0]!,
      nombre: c[1]!,
      fecha: c[2]!,
    })),
    ...recorrer<FilaCumple>(hCumple, 3, 8, 2, (c, fila) => ({
      fila,
      bloque: 'B',
      red: null,
      nombre: c[0]!,
      fecha: c[1]!,
    })),
  ];

  const hojasExhibidor: Record<string, FilaHojaExhibidor[]> = {};
  for (const nombre of o.hojasExhibidor) {
    const h = hojaDe(wbTr, nombre);
    exigirEncabezado(h, 2, 3, ['ID', 'Descripción', 'Costo de venta', 'Fecha de venta']);
    hojasExhibidor[nombre] = recorrer<FilaHojaExhibidor>(h, 3, 3, 4, (c, fila) => ({
      fila,
      id: c[0]!,
      descripcion: c[1]!,
      precio: c[2]!,
      fechaVenta: c[3]!,
    }));
  }

  return {
    archivos: [
      { rol: 'inventario', sha256: sha256(o.inventario), bytes: o.inventario.length },
      { rol: 'tracking', sha256: sha256(o.tracking), bytes: o.tracking.length },
    ],
    inventario,
    concentrado,
    lealtad,
    cumpleanos,
    hojasExhibidor,
  };
}

/** Hojas del Tracking que no son de exhibidor (se excluyen al descubrir las de exhibidor). */
const HOJAS_NO_EXHIBIDOR = new Set([
  'concentrado joyeria agos',
  'tarjeta de lealtad',
  'cumpleanos',
  'pedidos',
  'rifas',
]);

/** Nombres de las hojas de exhibidor del Tracking: todas menos Concentrado, Tarjeta, Cumpleaños, Pedidos y Rifas. */
export async function hojasExhibidorDe(tracking: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tracking as unknown as ArrayBuffer);
  return wb.worksheets.map((h) => h.name).filter((n) => !HOJAS_NO_EXHIBIDOR.has(llaveNombre(n)));
}

/** Lee los dos libros del disco. Solo lectura: nunca escribe en las rutas dadas. */
export async function leerArchivos(
  rutas: { inventario: string; tracking: string },
  hojasExhibidor?: string[],
): Promise<Libro> {
  const [inventario, tracking] = await Promise.all([readFile(rutas.inventario), readFile(rutas.tracking)]);
  return leerLibros({
    inventario,
    tracking,
    hojasExhibidor: hojasExhibidor ?? (await hojasExhibidorDe(tracking)),
  });
}
