import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { hojasExhibidorDe, leerArchivos, leerLibros } from '../../../scripts/migrar-excel/leer';
import { librosSinteticos } from '../../apoyo/libro-sintetico';

describe('leerLibros', () => {
  it('lee cada hoja con su número de fila de Excel y calcula el sha256', async () => {
    const b = await librosSinteticos({
      inventario: [
        ['ZZ01', 'Anillos', 'Anillo de prueba', 'Rodio', 'PROV UNO', 50, 99, 1, 'Kazero', null, null],
      ],
      concentrado: [
        [
          new Date(Date.UTC(2026, 0, 5)),
          40,
          120,
          'Clienta Uno',
          'Vendido',
          null,
          'ZZ90',
          'Collar de prueba',
          '10ene. Se aparta',
          'N/A',
          'Prov Uno',
          '1 10/1/26',
          'KZR-3',
        ],
      ],
      lealtad: [['Clienta Uno', new Date(Date.UTC(2026, 0, 10))]],
      cumpleA: [['IG', 'usuaria.prueba', new Date(Date.UTC(2024, 1, 29))]],
      cumpleB: [['Cliente Dos', new Date(Date.UTC(2000, 5, 1))]],
      exhibidores: { EXA: [['ZZ01', 'Anillo de prueba', 99, null]] },
    });
    const l = await leerLibros({ ...b, hojasExhibidor: ['EXA'] });
    expect(l.inventario).toEqual([
      expect.objectContaining({ fila: 2, id: 'ZZ01', precio: 99, cliente: null }),
    ]);
    expect(l.concentrado[0]).toMatchObject({ fila: 3, id: 'ZZ90', venta: 120, nota: 'KZR-3' });
    expect(l.lealtad[0]).toMatchObject({ fila: 4, cliente: 'Clienta Uno' });
    expect(l.lealtad[0]!.celdas).toHaveLength(10);
    expect(l.cumpleanos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bloque: 'A', red: 'IG', nombre: 'usuaria.prueba' }),
        expect.objectContaining({ bloque: 'B', red: null, nombre: 'Cliente Dos' }),
      ]),
    );
    expect(l.hojasExhibidor.EXA![0]).toMatchObject({ fila: 3, id: 'ZZ01', precio: 99 });
    expect(l.archivos.map((a) => a.rol)).toEqual(['inventario', 'tracking']);
    expect(l.archivos.map((a) => a.sha256)).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
  });

  it('las fórmulas se leen por su resultado y las filas totalmente vacías se omiten', async () => {
    const b = await librosSinteticos({
      inventario: [
        [null, null, null, null, null, null, null, null, null, null, null],
        ['ZZ02', 'Aretes', 'Arete de prueba', null, null, 10, 30, null, 'Kazero', null, null],
      ],
      concentrado: [
        [null, null, null, null, null, null, null, null, null, null, null, null, null],
        [
          null,
          10,
          { formula: 'B4*2', result: 20 },
          'Cliente Tres',
          'Vendido',
          null,
          'ZZ91',
          'x',
          null,
          null,
          null,
          null,
          null,
        ],
      ],
    });
    const l = await leerLibros({ ...b, hojasExhibidor: [] });
    expect(l.inventario).toHaveLength(1);
    expect(l.inventario[0]).toMatchObject({ fila: 3, id: 'ZZ02' });
    expect(l.concentrado).toHaveLength(1);
    expect(l.concentrado[0]).toMatchObject({ fila: 4, venta: 20 });
  });

  it('un encabezado distinto detiene la lectura con el nombre de la hoja', async () => {
    const b = await librosSinteticos({});
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(b.tracking as unknown as ArrayBuffer);
    wb.getWorksheet('Concentrado joyeria_agos')!.getRow(2).getCell(4).value = 'Clienta';
    const tracking = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(leerLibros({ inventario: b.inventario, tracking, hojasExhibidor: [] })).rejects.toThrow(
      /Encabezado inesperado en Concentrado/,
    );
  });

  it('una hoja de exhibidor inexistente se informa con su nombre', async () => {
    const b = await librosSinteticos({});
    await expect(leerLibros({ ...b, hojasExhibidor: ['NOEXISTE'] })).rejects.toThrow(/NOEXISTE/);
  });

  it('leerArchivos no modifica los originales (archivo de solo lectura, mismo contenido después)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kz-'));
    const b = await librosSinteticos({});
    const rutas = { inventario: join(dir, 'i.xlsx'), tracking: join(dir, 't.xlsx') };
    await writeFile(rutas.inventario, b.inventario);
    await writeFile(rutas.tracking, b.tracking);
    await chmod(rutas.inventario, 0o444);
    await chmod(rutas.tracking, 0o444);
    await leerArchivos(rutas, []);
    expect(await readFile(rutas.inventario)).toEqual(b.inventario);
    expect(await readFile(rutas.tracking)).toEqual(b.tracking);
  });
});

describe('hojasExhibidorDe', () => {
  it('descubre las hojas de exhibidor y excluye Concentrado, Tarjeta, Cumpleaños, Pedidos y Rifas', async () => {
    const b = await librosSinteticos({
      exhibidores: { 'Vend A': [], Pedidos: [], Rifas: [], Otra: [] },
    });
    expect(await hojasExhibidorDe(b.tracking)).toEqual(['Vend A', 'Otra']);
  });
});
