import ExcelJS from 'exceljs';

export interface DatosSinteticos {
  inventario?: (string | number | null)[][]; // sin encabezado
  concentrado?: (string | number | Date | { formula: string; result: number } | null)[][];
  lealtad?: (string | Date | null)[][]; // [cliente, pos1..pos10]
  cumpleA?: [string, string, Date | null][]; // [red, usuario, fecha]
  cumpleB?: [string, Date | null][];
  exhibidores?: Record<string, (string | number | null)[][]>;
}

const ENC_INV = [
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
];
const ENC_CONC = [
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
];

/** Dos libros .xlsx en memoria con la misma forma que los del cliente y datos inventados. */
export async function librosSinteticos(
  d: DatosSinteticos,
): Promise<{ inventario: Buffer; tracking: Buffer }> {
  const inv = new ExcelJS.Workbook();
  const hi = inv.addWorksheet('INVENTARIO');
  hi.addRow(ENC_INV);
  for (const f of d.inventario ?? []) hi.addRow(f);
  inv.addWorksheet('CLIENTES');

  const tr = new ExcelJS.Workbook();
  const hc = tr.addWorksheet('Concentrado joyeria_agos');
  hc.addRow(['CONCENTRADO DE JOYERÍA']);
  hc.addRow(ENC_CONC);
  for (const f of d.concentrado ?? []) hc.addRow(f);
  const ht = tr.addWorksheet('Tarjeta de Lealtad');
  ht.addRow([]);
  ht.addRow([null, 'Clientx', ...Array(10).fill('Número de compra')]);
  ht.addRow([null, 'Clientx', ...Array.from({ length: 10 }, (_, i) => i + 1)]);
  for (const f of d.lealtad ?? []) ht.addRow([null, ...f]);
  const hb = tr.addWorksheet('Cumpleaños ');
  hb.addRow([]);
  hb.addRow([null, 'Red social', 'Nombre', 'Fecha', null, null, null, 'Nombre', 'Fecha']);
  const n = Math.max(d.cumpleA?.length ?? 0, d.cumpleB?.length ?? 0);
  for (let i = 0; i < n; i++) {
    const a = d.cumpleA?.[i];
    const b = d.cumpleB?.[i];
    hb.addRow([
      null,
      a?.[0] ?? null,
      a?.[1] ?? null,
      a?.[2] ?? null,
      null,
      null,
      null,
      b?.[0] ?? null,
      b?.[1] ?? null,
    ]);
  }
  for (const [hoja, filas] of Object.entries(d.exhibidores ?? {})) {
    const he = tr.addWorksheet(hoja);
    he.addRow([]);
    he.addRow([null, null, 'ID', 'Descripción', 'Costo de venta', 'Fecha de venta']);
    for (const f of filas) he.addRow([null, null, ...f]);
  }
  return {
    inventario: Buffer.from(await inv.xlsx.writeBuffer()),
    tracking: Buffer.from(await tr.xlsx.writeBuffer()),
  };
}
