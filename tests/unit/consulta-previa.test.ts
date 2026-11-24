import { describe, expect, it } from 'vitest';
import { leerConsultaPrevia, urlConsultaPrevia } from '@/features/pedidos/consulta-previa';

const U = '0b0e4c43-4a6b-4a1f-9a5e-2f9d8d1e7c11';
describe('consulta de vista previa', () => {
  it('ida y vuelta', () => {
    const o = { clienteId: U, codigos: ['AF12', 'AF13'], cuentaTarjeta: true, fecha: '2026-11-20' };
    expect(leerConsultaPrevia(new URL(urlConsultaPrevia(o), 'http://x').searchParams)).toEqual(o);
  });
  it('sin cliente ni códigos es válida', () => {
    expect(leerConsultaPrevia(new URLSearchParams('tarjeta=0'))).toEqual({
      clienteId: null,
      codigos: [],
      cuentaTarjeta: false,
      fecha: null,
    });
  });
  it('L-7: una fecha vacía o a medio escribir no se manda (el servidor usa hoy)', () => {
    expect(urlConsultaPrevia({ clienteId: null, codigos: [], cuentaTarjeta: true, fecha: '' })).not.toContain(
      'fecha',
    );
    expect(
      urlConsultaPrevia({ clienteId: null, codigos: [], cuentaTarjeta: true, fecha: '2026-1' }),
    ).not.toContain('fecha');
  });
  it.each([
    'cliente=no-uuid',
    `cliente=${U}&codigos=${'A,'.repeat(101)}`,
    `codigos=${'x'.repeat(3000)}`,
    'fecha=2026-02-30',
    'fecha=ayer',
  ])('rechaza %s', (q) => {
    expect(leerConsultaPrevia(new URLSearchParams(q))).toBeNull();
  });
});
