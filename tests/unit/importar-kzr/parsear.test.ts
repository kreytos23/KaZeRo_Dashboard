import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { leerFilasBuffer } from '../../../scripts/importar-kzr/leer';
import {
  agruparNotas,
  hashFuente,
  iniciales,
  parsearNota,
  parsearTarjeta,
  partirVendedor,
  similitudDescripcion,
} from '../../../scripts/importar-kzr/parsear';
import type { FilaExcel } from '../../../scripts/importar-kzr/tipos';

const HOY = '2026-10-26';
const fila = (n: number, extra: Partial<FilaExcel> = {}): FilaExcel => ({
  fila: n,
  nota: 'KZR-08',
  id: 'zz01',
  descripcion: 'Collar uno',
  tarjeta: '1 16/09/2026',
  cliente: 'Clienta Uno',
  vendedor: 'Vend A - Clienta Uno',
  estatus: 'Por cobrar',
  ...extra,
});

describe('parsearNota', () => {
  it('«KZR-08» → 8; sin prefijo KZR o basura → null', () => {
    expect(parsearNota('KZR-08')).toBe(8);
    expect(parsearNota(' kzr 31 ')).toBe(31);
    expect(parsearNota('8')).toBeNull();
    expect(parsearNota('KZR-0')).toBeNull();
    expect(parsearNota('KZR-x')).toBeNull();
    expect(parsearNota(null)).toBeNull();
  });
});

describe('parsearTarjeta', () => {
  it('«N dd/mm/aaaa» → lugar y fecha ISO', () => {
    expect(parsearTarjeta('1 16/09/2026', HOY)).toEqual({ ok: true, lugar: 1, fecha: '2026-09-16' });
    expect(parsearTarjeta('10 5/9/2026', HOY)).toEqual({ ok: true, lugar: 10, fecha: '2026-09-05' });
    expect(parsearTarjeta(' 5   01/01/2026 ', HOY)).toEqual({ ok: true, lugar: 5, fecha: '2026-01-01' });
  });
  it('la fecha de hoy se acepta; una futura no', () => {
    expect(parsearTarjeta('2 26/10/2026', HOY).ok).toBe(true);
    expect(parsearTarjeta('2 27/10/2026', HOY)).toMatchObject({ ok: false, codigo: 'tarjeta_fecha_futura' });
  });
  it.each(['1.N', '1.5', '', '11 01/01/2026', '0 01/01/2026', '1 31/02/2026', '1 5/9/26', 'a 01/01/2026'])(
    'formato no soportado: «%s»',
    (t) => {
      expect(parsearTarjeta(t, HOY)).toMatchObject({ ok: false, codigo: 'tarjeta_formato_no_soportado' });
    },
  );
  it('celda vacía = formato no soportado', () => {
    expect(parsearTarjeta(null, HOY)).toMatchObject({ ok: false, codigo: 'tarjeta_formato_no_soportado' });
  });
});

describe('partirVendedor', () => {
  it('lo de antes de « - » es la vendedora; lo de después, la compradora (se ignora)', () => {
    expect(partirVendedor('Perla - Ana')).toEqual({ vendedora: 'Perla', comprador: 'Ana' });
    expect(partirVendedor('  Perla   -   Ana María ')).toEqual({
      vendedora: 'Perla',
      comprador: 'Ana María',
    });
  });
  it('sin « - » se usa todo el texto; un guion pegado no separa', () => {
    expect(partirVendedor('Perla')).toEqual({ vendedora: 'Perla', comprador: null });
    expect(partirVendedor('Ana-María')).toEqual({ vendedora: 'Ana-María', comprador: null });
  });
});

describe('similitudDescripcion / iniciales', () => {
  it('descripciones iguales o casi iguales ≈ 1; distintas ≈ 0', () => {
    expect(similitudDescripcion('Collar de plata', 'collar DE plata')).toBe(1);
    expect(similitudDescripcion('Collar de plata corazón', 'Collar plata')).toBeGreaterThan(0.4);
    expect(similitudDescripcion('Anillo oro', 'Pulsera acero inoxidable')).toBe(0);
  });
  it('iniciales no vuelcan el nombre', () => {
    expect(iniciales('Ana María Pérez')).toBe('A. M. P.');
  });
});

describe('agruparNotas', () => {
  it('filas con el mismo folio forman una nota (KZR-08 = kzr 8) y se normalizan los códigos', () => {
    const { notas, errores } = agruparNotas([
      fila(2),
      fila(3, { nota: 'kzr 8', id: ' zz02 ', cliente: 'CLIENTA  uno' }),
      fila(4, { nota: 'KZR-9', id: 'ZZ03' }),
    ]);
    expect(errores).toEqual([]);
    expect(notas.map((n) => [n.folio, n.codigos])).toEqual([
      [8, ['ZZ01', 'ZZ02']],
      [9, ['ZZ03']],
    ]);
    expect(notas[0]!.vendedora).toBe('Vend A');
  });
  it('error si las filas de una nota no coinciden en cliente, vendedor, tarjeta o estatus (sin volcar valores)', () => {
    for (const [campo, extra] of [
      ['cliente', { cliente: 'Otra Clienta' }],
      ['vendedor', { vendedor: 'Vend B' }],
      ['tarjeta', { tarjeta: '2 16/09/2026' }],
      ['estatus', { estatus: 'Pagado' }],
    ] as const) {
      const { notas, errores } = agruparNotas([fila(2), fila(3, extra)]);
      expect(notas).toEqual([]);
      expect(errores).toHaveLength(1);
      expect(errores[0]).toMatchObject({ codigo: 'nota_inconsistente', folio: 8, filas: [2, 3] });
      expect(errores[0]!.mensaje).toContain(campo);
      expect(errores[0]!.mensaje).not.toContain('Otra Clienta');
    }
  });
  it('nota inválida y celdas vacías son errores, no se descartan en silencio', () => {
    const { notas, errores } = agruparNotas([
      fila(2, { nota: 'XX-1' }),
      fila(3, { nota: 'KZR-3', tarjeta: null }),
      fila(4, { nota: 'KZR-4', id: null }),
    ]);
    expect(notas).toEqual([]);
    expect(errores.map((e) => e.codigo)).toEqual(['nota_invalida', 'campo_vacio', 'campo_vacio']);
  });
  it('hashFuente: estable ante el orden de filas y mayúsculas; cambia si cambia el contenido', () => {
    const a = agruparNotas([fila(2), fila(3, { id: 'ZZ02' })]).notas[0]!;
    const b = agruparNotas([fila(9, { id: 'zz02', cliente: 'clienta UNO' }), fila(10)]).notas[0]!;
    expect(hashFuente(a)).toBe(hashFuente(b));
    const c = agruparNotas([fila(2), fila(3, { id: 'ZZ09' })]).notas[0]!;
    expect(hashFuente(c)).not.toBe(hashFuente(a));
  });
});

describe('leerFilasBuffer', () => {
  async function libro(filas: (string | number | null)[][], encabezado?: string[]) {
    const wb = new ExcelJS.Workbook();
    const h = wb.addWorksheet('Hoja1');
    h.addRow(
      encabezado ?? ['Nota KZR', 'ID', 'Descripción', 'Tarjeta de Lealtad', 'Cliente', 'Vendedor', 'Estatus'],
    );
    for (const f of filas) h.addRow(f);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  it('lee una fila por pieza y salta las filas vacías', async () => {
    const r = await leerFilasBuffer(
      await libro([
        ['KZR-08', 'AB12', 'Collar', '1 16/09/2026', 'Cliente Uno', 'Vend A - Cliente Uno', 'Por cobrar'],
        [null, null, null, null, null, null, null],
        ['KZR-09', 'AB13', null, '2 17/09/2026', 'Cliente Dos', 'Vend A', 'Por cobrar'],
      ]),
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ fila: 2, nota: 'KZR-08', id: 'AB12', estatus: 'Por cobrar' });
    expect(r[1]).toMatchObject({ fila: 4, descripcion: null });
  });
  it('tolera la columna A vacía y filas previas al encabezado (los números de fila son los de la hoja)', async () => {
    const wb = new ExcelJS.Workbook();
    const h = wb.addWorksheet('Hoja1');
    h.addRow([]);
    h.addRow([null, 'Nota KZR', 'ID', 'Descripción', 'Tarjeta de Lealtad', 'Cliente', 'Vendedor', 'Estatus']);
    h.addRow([null, 'KZR-08', 'AB12', 'Collar', '1 16/09/2026', 'Cliente Uno', 'Vend A', 'Por cobrar']);
    const r = await leerFilasBuffer(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r).toEqual([
      expect.objectContaining({ fila: 3, nota: 'KZR-08', id: 'AB12', estatus: 'Por cobrar' }),
    ]);
  });
  it('encabezado inesperado → error', async () => {
    await expect(leerFilasBuffer(await libro([], ['A', 'B']))).rejects.toThrow(/Encabezado/);
  });
});
