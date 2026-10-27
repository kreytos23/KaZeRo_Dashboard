import { describe, expect, it } from 'vitest';
import { etiquetaUbicacion } from '@/domain/ubicacion';

const base = { exhibidorNombre: null, vendedorNombre: null };

describe('etiquetaUbicacion', () => {
  it('en casa', () =>
    expect(etiquetaUbicacion({ ...base, ubicacion: 'kazero', estado: 'disponible' })).toBe('Kazero'));
  it('en un exhibidor', () =>
    expect(
      etiquetaUbicacion({ ...base, ubicacion: 'exhibidor', exhibidorNombre: 'Perla 1', estado: 'exhibida' }),
    ).toBe('Exhibidor Perla 1'));
  it('con una vendedora', () =>
    expect(
      etiquetaUbicacion({ ...base, ubicacion: 'vendedora', vendedorNombre: 'Perla', estado: 'disponible' }),
    ).toBe('Con Perla'));
  it('vendida', () =>
    expect(etiquetaUbicacion({ ...base, ubicacion: 'fuera', estado: 'vendida' })).toBe('Vendida'));
  it('regalo', () =>
    expect(etiquetaUbicacion({ ...base, ubicacion: 'fuera', estado: 'regalo' })).toBe('Regalo'));
});
