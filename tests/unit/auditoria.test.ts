import { describe, expect, it } from 'vitest';
import {
  agruparHistorial,
  calcularCambios,
  montoCambio,
  requiereMotivo,
  validarMotivo,
  type FilaHistorial,
} from '@/domain/auditoria';

describe('calcularCambios (R-08)', () => {
  it('devuelve solo los campos que cambiaron, en el orden de `despues`', () => {
    expect(
      calcularCambios(
        { descripcion: 'Anillo', precio: '149.00', costo: '65.00' },
        { descripcion: 'Anillo dorado', precio: '149.00', costo: '70.00' },
      ),
    ).toEqual([
      { campo: 'descripcion', antes: 'Anillo', despues: 'Anillo dorado' },
      { campo: 'costo', antes: '65.00', despues: '70.00' },
    ]);
  });
  it('una edición sin cambios no produce nada (no-op)', () => {
    expect(calcularCambios({ nombre: 'Perla', telefono: null }, { nombre: 'Perla', telefono: null })).toEqual(
      [],
    );
  });
  it('de null a valor y de valor a null cuentan como cambio', () => {
    expect(calcularCambios({ telefono: null, notas: 'x' }, { telefono: '555', notas: null })).toEqual([
      { campo: 'telefono', antes: null, despues: '555' },
      { campo: 'notas', antes: 'x', despues: null },
    ]);
  });
  it('compara tal cual: el servicio canoniza antes ("149" ≠ "149.00")', () => {
    expect(calcularCambios({ precio: '149.00' }, { precio: '149' })).toHaveLength(1);
  });
});

describe('motivo (R-09)', () => {
  const cambio = (campo: string) => [{ campo, antes: '1', despues: '2' }];
  it('es obligatorio al cambiar precio o costo de una pieza y la comisión de un vendedor', () => {
    expect(requiereMotivo('pieza', cambio('precio'))).toBe(true);
    expect(requiereMotivo('pieza', cambio('costo'))).toBe(true);
    expect(requiereMotivo('vendedor', cambio('comision_pct'))).toBe(true);
  });
  it('es opcional en lo demás', () => {
    expect(requiereMotivo('pieza', cambio('descripcion'))).toBe(false);
    expect(requiereMotivo('vendedor', cambio('nombre'))).toBe(false);
    expect(requiereMotivo('cliente', cambio('telefono'))).toBe(false);
    expect(requiereMotivo('categoria', cambio('nombre'))).toBe(false);
  });
  it('validarMotivo: recorta, exige si hace falta y limita a 200 caracteres (code points)', () => {
    expect(validarMotivo('  Subió el proveedor ', true)).toEqual({ ok: true, motivo: 'Subió el proveedor' });
    expect(validarMotivo('   ', false)).toEqual({ ok: true, motivo: null });
    expect(validarMotivo(undefined, true)).toEqual({
      ok: false,
      error: 'Escribe el motivo: cambiaste un monto.',
    });
    expect(validarMotivo('', true, 'Escribe el motivo de la corrección.')).toEqual({
      ok: false,
      error: 'Escribe el motivo de la corrección.',
    });
    expect(validarMotivo('é'.repeat(200), true)).toMatchObject({ ok: true });
    expect(validarMotivo('😀'.repeat(200), true)).toMatchObject({ ok: true });
    expect(validarMotivo('a'.repeat(201), true)).toEqual({
      ok: false,
      error: 'El motivo admite hasta 200 caracteres.',
    });
  });
});

describe('montoCambio (ayuda de la UI)', () => {
  it('"149" y "149.00" son el mismo precio; "18" y "18.00" la misma comisión', () => {
    expect(montoCambio('pesos', '149', '149.00')).toBe(false);
    expect(montoCambio('pesos', '$1,299.50', '1299.50')).toBe(false);
    expect(montoCambio('porcentaje', '18', '18.00')).toBe(false);
  });
  it('un valor distinto o ilegible cuenta como cambio', () => {
    expect(montoCambio('pesos', '199', '149.00')).toBe(true);
    expect(montoCambio('pesos', 'mucho', '149.00')).toBe(true);
    expect(montoCambio('porcentaje', '20', '18.00')).toBe(true);
  });
});

describe('agruparHistorial', () => {
  const fila = (id: string, campo: string, motivo: string | null = null): FilaHistorial => ({
    auditoriaId: id,
    fecha: new Date('2026-10-11T18:00:00Z'),
    adminEmail: 'a@kazero.test',
    motivo,
    campo,
    antes: 'x',
    despues: 'y',
  });
  it('junta los campos de cada edición conservando el orden de la vista', () => {
    const r = agruparHistorial([
      fila('b', 'precio', 'Ajuste'),
      fila('b', 'costo', 'Ajuste'),
      fila('a', 'descripcion'),
    ]);
    expect(r.map((e) => [e.id, e.motivo, e.campos.map((c) => c.campo)])).toEqual([
      ['b', 'Ajuste', ['precio', 'costo']],
      ['a', null, ['descripcion']],
    ]);
  });
});
