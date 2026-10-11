import { describe, expect, it } from 'vitest';
import { MAX_FILAS_LOTE, parsearLote } from '@/domain/lote';

const fila = (codigo: string, precio = '149') =>
  [codigo, 'Anillos', 'Anillo serpiente', 'Oro laminado', 'ZABBEL', '65', precio].join('\t');

describe('alta por lote (pegar desde Excel)', () => {
  it('lee filas separadas por tabulador y omite el encabezado', () => {
    const texto = [
      'ID\tCategoria\tProducto\tMaterial\tProveedor\tCosto\tP. Venta',
      fila('aa01'),
      '',
      fila('AA02', '$1,299.50'),
    ].join('\r\n');
    const r = parsearLote(texto);
    expect(r.errores).toEqual([]);
    expect(r.filas).toEqual([
      {
        linea: 2,
        codigo: 'AA01',
        categoria: 'Anillos',
        descripcion: 'Anillo serpiente',
        material: 'Oro laminado',
        proveedor: 'ZABBEL',
        costoCentavos: 6500,
        precioCentavos: 14900,
      },
      {
        linea: 4,
        codigo: 'AA02',
        categoria: 'Anillos',
        descripcion: 'Anillo serpiente',
        material: 'Oro laminado',
        proveedor: 'ZABBEL',
        costoCentavos: 6500,
        precioCentavos: 129950,
      },
    ]);
  });
  it('reporta errores por línea sin detenerse', () => {
    const r = parsearLote([fila('AA01'), 'solo\tdos', fila('AA01'), fila('AA03', 'gratis')].join('\n'));
    expect(r.errores).toEqual([
      {
        linea: 2,
        mensaje: 'Se esperan 7 columnas: código, categoría, descripción, material, proveedor, costo, precio.',
      },
      { linea: 3, mensaje: 'Código AA01 repetido en el lote (también en la línea 1).' },
      { linea: 4, mensaje: 'El precio no es un monto válido.' },
    ]);
  });
  it('material, proveedor y costo pueden ir vacíos', () => {
    const r = parsearLote(['AB01', 'Aretes', 'Arete', '', '', '', '99'].join('\t'));
    expect(r.filas[0]).toMatchObject({
      material: null,
      proveedor: null,
      costoCentavos: 0,
      precioCentavos: 9900,
    });
  });
  it(`limita a ${MAX_FILAS_LOTE} piezas`, () => {
    const texto = Array.from({ length: MAX_FILAS_LOTE + 1 }, (_, i) =>
      fila(`ZZ${String(i + 1).padStart(3, '0')}`),
    ).join('\n');
    expect(parsearLote(texto).errores).toContainEqual({
      linea: 0,
      mensaje: `Máximo ${MAX_FILAS_LOTE} piezas por lote.`,
    });
  });
});
