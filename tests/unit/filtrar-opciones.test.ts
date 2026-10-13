import { describe, expect, it } from 'vitest';
import { filtrarOpciones } from '@/features/ui/filtrar-opciones';

const OPS = ['Anillos', 'Aretes', 'Collares', 'Pulseras', 'Arracadas', 'Dijes'];

describe('filtrarOpciones', () => {
  it('sin consulta devuelve todas en su orden', () => {
    expect(filtrarOpciones(OPS, '')).toEqual({ opciones: OPS, exacta: false });
  });
  it('primero las que empiezan con la consulta, luego las que la contienen; sin acentos ni mayúsculas', () => {
    expect(filtrarOpciones(['Collares', 'Anillos', 'Pulseras'], 'LL').opciones).toEqual([
      'Collares',
      'Anillos',
    ]);
    expect(filtrarOpciones(OPS, 'ar').opciones).toEqual(['Aretes', 'Arracadas', 'Collares']);
    expect(filtrarOpciones(['Cadena Ñandú', 'Árbol'], 'ARB').opciones).toEqual(['Árbol']);
  });
  it('marca coincidencia exacta normalizada', () => {
    expect(filtrarOpciones(['Acero inoxidable'], '  ACERO  inoxidable ').exacta).toBe(true);
    expect(filtrarOpciones(['Oro laminado'], 'oro').exacta).toBe(false);
  });
  it('respeta el límite', () => {
    const muchas = Array.from({ length: 80 }, (_, i) => `Op ${i}`);
    expect(filtrarOpciones(muchas, '').opciones).toHaveLength(50);
    expect(filtrarOpciones(muchas, 'op', 5).opciones).toHaveLength(5);
  });
  it('una consulta sin coincidencias devuelve lista vacía', () => {
    expect(filtrarOpciones(OPS, 'zzz')).toEqual({ opciones: [], exacta: false });
  });
});
