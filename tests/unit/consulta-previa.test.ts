import { describe, expect, it } from 'vitest';
import { leerConsultaPrevia, urlConsultaPrevia } from '@/features/pedidos/consulta-previa';

const U = '0b0e4c43-4a6b-4a1f-9a5e-2f9d8d1e7c11';
describe('consulta de vista previa', () => {
  it('ida y vuelta', () => {
    const o = { clienteId: U, codigos: ['AF12', 'AF13'], cuentaTarjeta: true };
    expect(leerConsultaPrevia(new URL(urlConsultaPrevia(o), 'http://x').searchParams)).toEqual(o);
  });
  it('sin cliente ni códigos es válida', () => {
    expect(leerConsultaPrevia(new URLSearchParams('tarjeta=0'))).toEqual({
      clienteId: null,
      codigos: [],
      cuentaTarjeta: false,
    });
  });
  it.each(['cliente=no-uuid', `cliente=${U}&codigos=${'A,'.repeat(101)}`, `codigos=${'x'.repeat(3000)}`])(
    'rechaza %s',
    (q) => {
      expect(leerConsultaPrevia(new URLSearchParams(q))).toBeNull();
    },
  );
});
