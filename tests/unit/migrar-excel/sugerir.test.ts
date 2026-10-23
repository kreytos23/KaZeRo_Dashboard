import { describe, expect, it } from 'vitest';
import { leerLibros } from '../../../scripts/migrar-excel/leer';
import { planificar } from '../../../scripts/migrar-excel/planificar';
import { claseSugerida, sugerirMapeo } from '../../../scripts/migrar-excel/sugerir';
import { esquemaMapeo } from '../../../scripts/migrar-excel/tipos';
import { fecha, filaConc, filaInv, librosSinteticos } from '../../apoyo/libro-sintetico';

describe('sugerirMapeo', () => {
  it('clasifica los estatus escritos a mano', () => {
    expect(claseSugerida('Vendido')).toBe('vendido');
    expect(claseSugerida('No se cobró')).toBe('no_cobrado');
    expect(claseSugerida('Rifa 30 agos')).toBe('rifa');
    expect(claseSugerida('Vend A 06jul')).toBe('exhibidor');
    expect(claseSugerida('Cosa rara')).toBe('ignorar');
  });

  it('propone un mapeo válido con el que planificar corre sin rechazos por falta de mapeo', async () => {
    const b = await librosSinteticos({
      inventario: [
        filaInv({ id: 'ZZ01', ubic: 'Kazero', vend: 'Casa Prueba' }),
        filaInv({ id: 'ZZ02', ubic: 'Exhibidor Vend A - 16sep', vend: 'Vend A' }),
        filaInv({ id: 'ZZ03', ubic: 'Kazero', prov: 12345 }),
      ],
      concentrado: [
        filaConc({
          f: fecha(2026, 9, 1),
          venta: 100,
          cliente: 'Vend A - Clienta Uno',
          estatus: 'Vendido',
          id: 'AB01',
          desc: 'Anillo',
          com: '15% Vend A - sep',
        }),
        filaConc({
          f: fecha(2026, 9, 1),
          venta: 100,
          cliente: 'Clienta Dos',
          estatus: 'Por cobrar',
          id: 'AB02',
          desc: 'Pulsera',
          prov: 'Prov  Uno',
        }),
        filaConc({
          f: fecha(2026, 9, 1),
          venta: 100,
          cliente: 'Clienta Dos',
          estatus: 'Cosa rara',
          id: 'AB03',
          desc: 'Pulsera',
        }),
      ],
    });
    const libro = await leerLibros({ ...b, hojasExhibidor: [] });
    const { mapeo } = sugerirMapeo(libro, '2026-10-03');
    const parsed = esquemaMapeo.parse(mapeo);
    expect(parsed.vendedores.filter((v) => v.tipo === 'casa')).toHaveLength(1);
    expect(parsed.estatus['cosa rara']).toBe('ignorar');
    expect(parsed.exhibidores).toEqual([
      expect.objectContaining({
        texto: 'Exhibidor Vend A - 16sep',
        vendedor: 'Vend A',
        fechaEnvio: '2026-09-16',
      }),
    ]);
    const { plan } = planificar(libro, parsed);
    expect(plan.rechazos.map((r) => r.motivo)).toEqual(['estatus ignorado']);
  });
});
