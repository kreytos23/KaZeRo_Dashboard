import { describe, expect, it } from 'vitest';
import {
  acotarPagina,
  calcularPaginacion,
  elementosPaginacion,
  totalDePaginas,
  type ElementoPaginacion,
} from '@/domain/paginacion';

const vista = (els: ElementoPaginacion[]) => els.map((e) => (e.tipo === 'pagina' ? e.numero : '…'));

describe('totalDePaginas / acotarPagina', () => {
  it('cuenta páginas y nunca baja de 1', () => {
    expect(totalDePaginas(0, 50)).toBe(1);
    expect(totalDePaginas(50, 50)).toBe(1);
    expect(totalDePaginas(51, 50)).toBe(2);
    expect(totalDePaginas(911, 50)).toBe(19);
  });
  it('acota fuera de rango y trata lo inválido como página 1', () => {
    expect(acotarPagina(99, 911, 50)).toBe(19);
    expect(acotarPagina(0, 911, 50)).toBe(1);
    expect(acotarPagina(-3, 911, 50)).toBe(1);
    expect(acotarPagina(Number.NaN, 911, 50)).toBe(1);
    expect(acotarPagina(5, 0, 50)).toBe(1);
  });
});

describe('elementosPaginacion', () => {
  it('con pocas páginas las muestra todas sin huecos', () => {
    expect(vista(elementosPaginacion(1, 1))).toEqual([1]);
    expect(vista(elementosPaginacion(2, 3))).toEqual([1, 2, 3]);
    expect(vista(elementosPaginacion(3, 5))).toEqual([1, 2, 3, 4, 5]);
  });
  it('en la primera página la ventana se pega al inicio', () => {
    expect(vista(elementosPaginacion(1, 20))).toEqual([1, 2, 3, 4, 5, '…', 20]);
    expect(vista(elementosPaginacion(2, 20))).toEqual([1, 2, 3, 4, 5, '…', 20]);
  });
  it('en la última página la ventana se pega al final', () => {
    expect(vista(elementosPaginacion(20, 20))).toEqual([1, '…', 16, 17, 18, 19, 20]);
    expect(vista(elementosPaginacion(19, 20))).toEqual([1, '…', 16, 17, 18, 19, 20]);
  });
  it('en medio centra la ventana con huecos a ambos lados', () => {
    expect(vista(elementosPaginacion(10, 20))).toEqual([1, '…', 8, 9, 10, 11, 12, '…', 20]);
  });
  it('un hueco de una sola página se muestra como número', () => {
    expect(vista(elementosPaginacion(5, 20))).toEqual([1, 2, 3, 4, 5, 6, 7, '…', 20]);
    expect(vista(elementosPaginacion(16, 20))).toEqual([1, '…', 14, 15, 16, 17, 18, 19, 20]);
    expect(vista(elementosPaginacion(4, 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('acota una página fuera de rango', () => {
    expect(vista(elementosPaginacion(99, 20))).toEqual([1, '…', 16, 17, 18, 19, 20]);
    expect(vista(elementosPaginacion(-1, 20))).toEqual([1, 2, 3, 4, 5, '…', 20]);
  });
  it('con muchísimas páginas sigue acotado', () => {
    expect(elementosPaginacion(500, 1000)).toHaveLength(9);
  });
});

describe('calcularPaginacion', () => {
  it('rango «Mostrando 51–100 de 911»', () => {
    const p = calcularPaginacion({ pagina: 2, total: 911, porPagina: 50 });
    expect([p.desde, p.hasta, p.total, p.totalPaginas]).toEqual([51, 100, 911, 19]);
  });
  it('la última página termina en el total', () => {
    const p = calcularPaginacion({ pagina: 19, total: 911, porPagina: 50 });
    expect([p.desde, p.hasta]).toEqual([901, 911]);
  });
  it('acota la página pedida a la última', () => {
    const p = calcularPaginacion({ pagina: 400, total: 911, porPagina: 50 });
    expect(p.pagina).toBe(19);
    expect(p.desde).toBe(901);
  });
  it('sin filas el rango es 0–0 y hay una sola página', () => {
    const p = calcularPaginacion({ pagina: 3, total: 0, porPagina: 50 });
    expect([p.pagina, p.totalPaginas, p.desde, p.hasta]).toEqual([1, 1, 0, 0]);
  });
});
