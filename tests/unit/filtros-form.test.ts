import { describe, expect, it } from 'vitest';
import { consultaDeFiltros, fechasListas, urlDeFiltros } from '@/features/ui/filtros-form';

describe('filtros-form', () => {
  it('consultaDeFiltros quita los vacíos y conserva el orden y las claves repetidas', () => {
    expect(
      consultaDeFiltros([
        ['mes', '2026-11'],
        ['exhibidor', ''],
        ['ventas', '1'],
      ]),
    ).toBe('mes=2026-11&ventas=1');
    expect(
      consultaDeFiltros([
        ['a', 'x'],
        ['a', 'y'],
      ]),
    ).toBe('a=x&a=y');
    expect(consultaDeFiltros([['vendedor', '']])).toBe('');
  });

  it('consultaDeFiltros ignora archivos', () => {
    const fd = new FormData();
    fd.append('mes', '2026-11');
    fd.append('foto', new Blob(['x']), 'foto.png');
    expect(consultaDeFiltros(fd)).toBe('mes=2026-11');
  });

  it('urlDeFiltros: sin consulta, la ruta sola', () => {
    expect(urlDeFiltros('/panel/reportes/deudores', '')).toBe('/panel/reportes/deudores');
    expect(urlDeFiltros('/panel/reportes/deudores', 'vendedor=v1')).toBe(
      '/panel/reportes/deudores?vendedor=v1',
    );
  });

  it('fechasListas: vacías o completas sí; a medias o inexistentes no', () => {
    expect(fechasListas([])).toBe(true);
    expect(
      fechasListas([
        { valor: '2026-11-01', aMedias: false },
        { valor: '', aMedias: false },
      ]),
    ).toBe(true);
    expect(
      fechasListas([
        { valor: '2026-11-01', aMedias: false },
        { valor: '', aMedias: true },
      ]),
    ).toBe(false);
    expect(fechasListas([{ valor: '2026-02-30', aMedias: false }])).toBe(false);
    expect(fechasListas([{ valor: '2026-11', aMedias: false }])).toBe(false);
  });
});
