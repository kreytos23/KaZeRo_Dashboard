import { describe, expect, it } from 'vitest';
import { buscarElegibles, codigosPegados, unirCodigos } from '@/features/piezas/lote-piezas';

const pieza = (codigo: string, descripcion: string) => ({
  id: `id-${codigo}`,
  codigo,
  descripcion,
  imagenClave: null,
});

const PIEZAS = [
  pieza('AN10', 'Anillo serpiente'),
  pieza('AN1', 'Anillo liso'),
  pieza('AR05', 'Arete corazón'),
  pieza('CO01', 'Collar con dije de anillo'),
  pieza('PU02', 'Pulsera Ñandú'),
];
const codigos = (xs: { codigo: string }[]) => xs.map((x) => x.codigo);

describe('buscarElegibles', () => {
  it('sin consulta no sugiere nada', () => {
    expect(buscarElegibles(PIEZAS, '   ', new Set())).toEqual([]);
  });
  it('el código exacto va primero, luego los que empiezan por la consulta y al final la descripción', () => {
    expect(codigos(buscarElegibles(PIEZAS, 'an1', new Set()))).toEqual(['AN1', 'AN10']);
    expect(codigos(buscarElegibles(PIEZAS, 'anillo', new Set()))).toEqual(['AN10', 'AN1', 'CO01']);
  });
  it('busca en la descripción sin acentos ni mayúsculas', () => {
    expect(codigos(buscarElegibles(PIEZAS, 'CORAZON', new Set()))).toEqual(['AR05']);
    expect(codigos(buscarElegibles(PIEZAS, 'nandu', new Set()))).toEqual(['PU02']);
  });
  it('no vuelve a ofrecer las piezas ya elegidas', () => {
    expect(codigos(buscarElegibles(PIEZAS, 'an1', new Set(['AN1'])))).toEqual(['AN10']);
  });
  it('respeta el límite (8 por omisión)', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => pieza(`XA${i}`, 'Anillo'));
    expect(buscarElegibles(muchas, 'xa', new Set())).toHaveLength(8);
    expect(buscarElegibles(muchas, 'xa', new Set(), 3)).toHaveLength(3);
  });
});

describe('codigosPegados', () => {
  it('parte por saltos de línea, espacios, tabuladores y comas, y normaliza', () => {
    expect(codigosPegados(' an01\nAr02, co03\t pu04 \r\n')).toEqual(['AN01', 'AR02', 'CO03', 'PU04']);
  });
  it('un texto vacío no da códigos', () => {
    expect(codigosPegados('  \n , ')).toEqual([]);
  });
});

describe('unirCodigos', () => {
  it('une las listas en orden y sin duplicados', () => {
    expect(unirCodigos(['AN01', 'AR02'], ['ar02', 'CO03', 'AN01'])).toEqual(['AN01', 'AR02', 'CO03']);
  });
});
