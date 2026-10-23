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

/** Fecha de Excel (UTC) para las filas sintéticas. */
export const fecha = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));

type CeldaConc = string | number | Date | null;

/** Fila del Concentrado (13 columnas) con valores por nombre. */
export function filaConc(o: {
  f?: Date | null;
  costo?: number | string | null;
  venta?: number | string | null;
  cliente?: string | null;
  estatus?: string | null;
  id?: string | number | null;
  desc?: string | null;
  coment?: string | null;
  com?: string | Date | null;
  prov?: string | number | null;
  tarjeta?: string | null;
  nota?: string | Date | null;
}): CeldaConc[] {
  return [
    o.f ?? null,
    o.costo ?? null,
    o.venta ?? null,
    o.cliente ?? null,
    o.estatus ?? null,
    null,
    o.id ?? null,
    o.desc ?? null,
    o.coment ?? null,
    o.com ?? 'N/A',
    o.prov ?? null,
    o.tarjeta ?? null,
    o.nota ?? null,
  ];
}

/** Fila del inventario (11 columnas). */
export function filaInv(o: {
  id: string;
  cat?: string;
  prod?: string;
  mat?: string | null;
  prov?: string | number | null;
  costo?: number | null;
  precio?: number | null;
  ubic?: string;
  cliente?: string | null;
  vend?: string | null;
}): (string | number | null)[] {
  return [
    o.id,
    o.cat ?? 'Anillos',
    o.prod ?? 'Anillo de prueba',
    o.mat === undefined ? 'Rodio' : o.mat,
    o.prov === undefined ? 'PROV UNO' : o.prov,
    o.costo === undefined ? 50 : o.costo,
    o.precio === undefined ? 150 : o.precio,
    1,
    o.ubic ?? 'Kazero',
    o.cliente ?? null,
    o.vend ?? null,
  ];
}
