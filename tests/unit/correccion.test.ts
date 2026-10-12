import { describe, expect, it } from 'vitest';
import { describirDestino, destinoCorreccion, mensajeCorreccion } from '@/domain/correccion';

const EX = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';
const manual = (deEstado: 'disponible' | 'en_exhibidor', aEstado: 'regalo' | 'defecto' | 'guardada') => ({
  tipo: 'cambio_estado',
  deEstado,
  aEstado,
  exhibidorId: deEstado === 'en_exhibidor' ? EX : null,
});

describe('destinoCorreccion (R-07)', () => {
  it('regalo, defecto o guardada desde disponible vuelven a disponible', () => {
    for (const a of ['regalo', 'defecto', 'guardada'] as const)
      expect(destinoCorreccion(a, manual('disponible', a), false)).toEqual({
        aEstado: 'disponible',
        exhibidorId: null,
        exhibidorCerrado: false,
      });
  });
  it('desde un exhibidor abierto vuelve al mismo exhibidor', () => {
    expect(destinoCorreccion('defecto', manual('en_exhibidor', 'defecto'), true)).toEqual({
      aEstado: 'en_exhibidor',
      exhibidorId: EX,
      exhibidorCerrado: false,
    });
  });
  it('si ese exhibidor ya se cerró, vuelve a disponible y lo dice', () => {
    expect(destinoCorreccion('guardada', manual('en_exhibidor', 'guardada'), false)).toEqual({
      aEstado: 'disponible',
      exhibidorId: null,
      exhibidorCerrado: true,
    });
  });
  it('solo el último movimiento y solo si fue manual', () => {
    expect(
      destinoCorreccion(
        'disponible',
        { tipo: 'alta', deEstado: null, aEstado: 'disponible', exhibidorId: null },
        false,
      ),
    ).toBeNull();
    expect(
      destinoCorreccion(
        'regalo',
        { tipo: 'correccion', deEstado: 'disponible', aEstado: 'regalo', exhibidorId: null },
        false,
      ),
    ).toBeNull();
    expect(destinoCorreccion('regalo', undefined, false)).toBeNull();
    // El último movimiento no corresponde al estado actual (dato incoherente): no se adivina.
    expect(destinoCorreccion('regalo', manual('disponible', 'defecto'), false)).toBeNull();
  });
  it('no aplica a apartada, vendida ni a un cambio manual hacia disponible', () => {
    expect(
      destinoCorreccion(
        'apartada',
        { tipo: 'cambio_estado', deEstado: 'disponible', aEstado: 'apartada', exhibidorId: null },
        false,
      ),
    ).toBeNull();
    expect(
      destinoCorreccion(
        'vendida',
        { tipo: 'venta', deEstado: 'apartada', aEstado: 'vendida', exhibidorId: null },
        false,
      ),
    ).toBeNull();
    expect(
      destinoCorreccion(
        'disponible',
        { tipo: 'cambio_estado', deEstado: 'defecto', aEstado: 'disponible', exhibidorId: null },
        false,
      ),
    ).toBeNull();
  });
});

describe('textos de la corrección', () => {
  it('describe a dónde volverá la pieza', () => {
    expect(
      describirDestino({ aEstado: 'disponible', exhibidorId: null, exhibidorCerrado: false }, null),
    ).toBe('La pieza volverá a Disponible.');
    expect(
      describirDestino({ aEstado: 'en_exhibidor', exhibidorId: EX, exhibidorCerrado: false }, 'Exh Nelly'),
    ).toBe('La pieza volverá al exhibidor Exh Nelly.');
    expect(
      describirDestino({ aEstado: 'disponible', exhibidorId: null, exhibidorCerrado: true }, 'Exh Nelly'),
    ).toBe('La pieza volverá a Disponible: el exhibidor Exh Nelly ya está cerrado.');
  });
  it('confirma lo que pasó', () => {
    expect(mensajeCorreccion({ aEstado: 'disponible', exhibidorNombre: null, exhibidorCerrado: false })).toBe(
      'Cambio deshecho: la pieza volvió a Disponible.',
    );
    expect(
      mensajeCorreccion({ aEstado: 'en_exhibidor', exhibidorNombre: 'Exh Nelly', exhibidorCerrado: false }),
    ).toBe('Cambio deshecho: la pieza volvió al exhibidor Exh Nelly.');
    expect(
      mensajeCorreccion({ aEstado: 'disponible', exhibidorNombre: 'Exh Nelly', exhibidorCerrado: true }),
    ).toBe('Cambio deshecho. El exhibidor Exh Nelly está cerrado: la pieza quedó disponible.');
  });
});
