import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { HOJA_TARJETAS, leerTarjetasBuffer } from '../../../scripts/importar-tarjetas/leer';

async function libro(filas: (string | number | null)[][], hoja = HOJA_TARJETAS) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(hoja);
  ws.getCell('B2').value = 'Cliente';
  ['Nombre', 'Apellido', '# de compra', 'Vendedor'].forEach(
    (t, i) => (ws.getRow(3).getCell(2 + i).value = t),
  );
  filas.forEach((f, r) => f.forEach((v, c) => (ws.getRow(4 + r).getCell(2 + c).value = v)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('leer el Excel de tarjetas', () => {
  it('encuentra el encabezado aunque no esté en A1 y salta filas vacías', async () => {
    const filas = await leerTarjetasBuffer(
      await libro([
        ['Ana', 'Uno', 4, 'Perla'],
        [null, null, null, null],
        ['Bea', 'Dos', 1, 'Kazero'],
      ]),
    );
    expect(filas).toEqual([
      { fila: 4, nombre: 'Ana', apellido: 'Uno', compras: 4, vendedor: 'Perla' },
      { fila: 6, nombre: 'Bea', apellido: 'Dos', compras: 1, vendedor: 'Kazero' },
    ]);
  });
  it('sin la hoja esperada, falla', async () => {
    await expect(leerTarjetasBuffer(await libro([], 'Otra'))).rejects.toThrow(/Hoja no encontrada/);
  });
});
