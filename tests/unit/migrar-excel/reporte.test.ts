import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leerLibros } from '../../../scripts/migrar-excel/leer';
import { planificar } from '../../../scripts/migrar-excel/planificar';
import { csvCelda, escribirReporte } from '../../../scripts/migrar-excel/reporte';
import { fecha, filaConc, librosSinteticos } from '../../apoyo/libro-sintetico';
import { mapeoSintetico } from '../../apoyo/mapeo-sintetico';

describe('reporte', () => {
  it('M-49 csvCelda escapa fórmulas (= + - @ tab CR), comillas y saltos de línea', () => {
    expect(csvCelda('=SUMA(1)')).toBe("'=SUMA(1)");
    expect(csvCelda('+1')).toBe("'+1");
    expect(csvCelda('-1')).toBe("'-1");
    expect(csvCelda('@x')).toBe("'@x");
    expect(csvCelda('\tx')).toBe("'\tx");
    expect(csvCelda('dice "hola", ok')).toBe('"dice ""hola"", ok"');
    expect(csvCelda(null)).toBe('');
    expect(csvCelda(12)).toBe('12');
  });

  it('M-49 reporte.md y CSV: conteos, meses, saldos, tarjeta, rechazos, avisos, SHA-256 y hash', async () => {
    const b = await librosSinteticos({
      concentrado: [
        filaConc({
          f: fecha(2026, 9, 1),
          venta: 100,
          cliente: '=SUMA(1)',
          estatus: 'Vendido',
          id: 'AB01',
          desc: 'Anillo',
          coment: '=SUMA(1) / 05sep.',
        }),
        filaConc({
          f: fecha(2026, 9, 1),
          venta: 300,
          cliente: 'Clienta Dos',
          estatus: 'Por cobrar',
          id: 'AB02',
          desc: 'Anillo',
          coment: '06sep. RESTA 50',
        }),
        filaConc({
          f: fecha(2026, 9, 1),
          venta: 300,
          cliente: 'Clienta Dos',
          estatus: 'Cambio',
          id: 'AB03',
          desc: 'Anillo',
        }),
      ],
      lealtad: [['Clienta Dos', fecha(2026, 9, 6)]],
    });
    const { plan, hash } = planificar(await leerLibros({ ...b, hojasExhibidor: [] }), mapeoSintetico());
    const dir = join(await mkdtemp(join(tmpdir(), 'rep-')), 'salida');
    const rutas = await escribirReporte(dir, { plan, hash, modo: 'simular' });
    expect(rutas.map((r) => r.split(/[\\/]/).pop()).sort()).toEqual([
      'avisos.csv',
      'clientes.csv',
      'pedidos.csv',
      'rechazos.csv',
      'reporte.md',
      'tarjeta.csv',
    ]);
    const md = await readFile(join(dir, 'reporte.md'), 'utf8');
    expect(md).toContain(hash);
    for (const a of plan.archivos) expect(md).toContain(a.sha256);
    expect(md).toContain('## Conteos');
    expect(md).toContain('## Totales por mes');
    expect(md).toContain('| 2026-09 | 2 | 400.00 | 350.00 | 50.00 |');
    expect(md).toContain('Σ saldo: **50.00**');
    expect(md).toContain('| Clienta Dos | 50.00 |');
    expect(md).toContain('## Tarjeta de lealtad por cliente');
    expect(md).toContain('| estatus ignorado | 1 |');
    expect(md).toContain('## Avisos');
    const pedidos = await readFile(join(dir, 'pedidos.csv'), 'utf8');
    expect(pedidos).toContain("'=SUMA(1)"); // el nombre del cliente no queda como fórmula
    expect(pedidos.split('\n')[0]).toContain('folio');
    expect(await readFile(join(dir, 'rechazos.csv'), 'utf8')).toContain('estatus ignorado');
  });
});
