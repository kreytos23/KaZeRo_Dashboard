import { describe, expect, it } from 'vitest';
import { hashPlan, jsonCanonico, uuidDeterminista } from '../../../scripts/migrar-excel/ids';
import {
  categoriaDeDescripcion,
  centavosDeCelda,
  clasificarEstatus,
  codigoDeCelda,
  codigoHistorico,
  fechaDeCelda,
  fechasDeComentario,
  inferirFecha,
  llaveNombre,
  parsearTarjeta,
  proveedorCanonico,
  restaDeComentario,
  separarPrefijo,
  similitud,
} from '../../../scripts/migrar-excel/normalizar';
import type { Mapeo } from '../../../scripts/migrar-excel/tipos';
import { normalizar } from '../../../src/domain/texto';

const mapeo: Mapeo = {
  estatus: { vendido: 'vendido', 'por cobrar': 'por_cobrar', 'no se cobro': 'no_cobrado' },
  proveedores: { 'prov uno': 'Proveedor Uno' },
  categoriasPorPalabra: { pulsera: 'Pulseras', huggie: 'Huggies', collar: 'Collares' },
  categoriaSinDato: 'Sin categoría (histórico)',
};

describe('normalizar', () => {
  it('M-01 montos: flotante de Excel con 2 decimales sí; más decimales, negativos o texto raro no', () => {
    expect(centavosDeCelda(938.1)).toBe(93810);
    expect(centavosDeCelda(20943.75)).toBe(2094375);
    expect(centavosDeCelda(938.0999999999999)).toBe(93810); // ruido binario de Excel
    expect(centavosDeCelda(1.234)).toBeNull();
    expect(centavosDeCelda(-5)).toBeNull();
    expect(centavosDeCelda(Number.NaN)).toBeNull();
    expect(centavosDeCelda('$1,250.50')).toBe(125050);
    expect(centavosDeCelda('mil')).toBeNull();
    expect(centavosDeCelda(null)).toBeNull();
    expect(centavosDeCelda(new Date(Date.UTC(2026, 0, 1)))).toBeNull();
  });

  it('M-02 código de celda: texto o entero válido, normalizado; lo demás null', () => {
    expect(codigoDeCelda(' zz 14 ')).toBe('ZZ14');
    expect(codigoDeCelda(1234)).toBe('1234');
    expect(codigoDeCelda(12.5)).toBeNull();
    expect(codigoDeCelda('###')).toBeNull();
    expect(codigoDeCelda('A'.repeat(21))).toBeNull();
    expect(codigoDeCelda(null)).toBeNull();
    expect(codigoDeCelda(new Date())).toBeNull();
  });

  it('M-03 código histórico: H-<código>, sufijo si se repite, H-F<fila> sin código', () => {
    const usados = new Set<string>();
    expect(codigoHistorico('ZZ14', 10, usados)).toBe('H-ZZ14');
    expect(codigoHistorico('ZZ14', 20, usados)).toBe('H-ZZ14-2');
    expect(codigoHistorico(null, 2439, usados)).toBe('H-F2439');
    expect(codigoHistorico('ABCDEFGHIJKLMNOPQRS', 7, usados)).toBe('H-F7'); // no cabe en 20
    for (const c of usados) expect(c).toMatch(/^[A-Z0-9][A-Z0-9-]{0,19}$/);
  });

  it('M-04 llave de nombre: paridad con normalizar() y sin puntuación ni espacios dobles', () => {
    expect(llaveNombre('José  Pérez.')).toBe('jose perez');
    expect(llaveNombre('  ANA, María ')).toBe('ana maria');
    expect(llaveNombre('Ünica')).toBe(normalizar('Ünica'));
    expect(llaveNombre('...')).toBe('');
  });

  it('M-05 prefijo: vendedor conocido → vendedor; otro → referencia; solo el primer " - "', () => {
    const alias = new Map([['vendedora a', 'Vendedora A']]);
    expect(separarPrefijo('Vendedora A - Clienta Uno', alias)).toEqual({
      nombre: 'Clienta Uno',
      vendedor: 'Vendedora A',
      referencia: null,
    });
    expect(separarPrefijo('Prima - Clienta Dos - Oficina', alias)).toEqual({
      nombre: 'Clienta Dos - Oficina',
      vendedor: null,
      referencia: 'Prima',
    });
    expect(separarPrefijo('Clienta Tres', alias)).toEqual({
      nombre: 'Clienta Tres',
      vendedor: null,
      referencia: null,
    });
  });

  it('M-06 fechas de celda: año 1900 y posteriores al corte se descartan', () => {
    expect(fechaDeCelda(new Date(Date.UTC(1900, 0, 6)), '2026-10-03')).toBeNull();
    expect(fechaDeCelda(new Date(Date.UTC(2026, 9, 4)), '2026-10-03')).toBeNull();
    expect(fechaDeCelda(new Date(Date.UTC(2025, 4, 21)), '2026-10-03')).toBe('2025-05-21');
    expect(fechaDeCelda(new Date(Date.UTC(2026, 9, 3)), '2026-10-03')).toBe('2026-10-03');
    expect(fechaDeCelda('2025-05-21', '2026-10-03')).toBeNull();
    expect(fechaDeCelda(null, '2026-10-03')).toBeNull();
  });

  it('M-07 fechas en comentarios: día + mes abreviado o completo, sin acentos ni mayúsculas', () => {
    expect(fechasDeComentario('10ene. Se aparta / 25 Sept. paga')).toEqual([
      { dia: 10, mes: 1 },
      { dia: 25, mes: 9 },
    ]);
    expect(fechasDeComentario('03AGOS y 4 agosto, 7 dic')).toEqual([
      { dia: 3, mes: 8 },
      { dia: 4, mes: 8 },
      { dia: 7, mes: 12 },
    ]);
    expect(fechasDeComentario('5 maravillas, 40 ene')).toEqual([]);
    expect(fechasDeComentario('sin fechas')).toEqual([]);
  });

  it('M-08 año inferido: primera fecha tras la compra; sin compra, la más reciente antes del corte', () => {
    expect(inferirFecha({ dia: 21, mes: 5 }, { desde: '2025-04-30', hasta: '2026-10-03' })).toBe(
      '2025-05-21',
    );
    expect(inferirFecha({ dia: 10, mes: 1 }, { desde: '2025-12-20', hasta: '2026-10-03' })).toBe(
      '2026-01-10',
    );
    expect(inferirFecha({ dia: 15, mes: 9 }, { desde: null, hasta: '2026-10-03' })).toBe('2026-09-15');
    expect(inferirFecha({ dia: 29, mes: 2 }, { desde: null, hasta: '2026-10-03' })).toBe('2024-02-29');
    expect(inferirFecha({ dia: 31, mes: 4 }, { desde: null, hasta: '2026-10-03' })).toBeNull();
    expect(inferirFecha({ dia: 15, mes: 11 }, { desde: null, hasta: '2026-10-03' })).toBe('2025-11-15');
    expect(inferirFecha({ dia: 15, mes: 11 }, { desde: '2026-10-01', hasta: '2026-10-03' })).toBeNull();
  });

  it('M-09 tarjeta: "N d/m/aa", "N.M …", "N TBD" y etiquetas', () => {
    expect(parsearTarjeta('3 21/5/25')).toEqual({
      posicion: 3,
      ciclo: null,
      fecha: '2025-05-21',
      tbd: false,
    });
    expect(parsearTarjeta('1.4 2/3/26')).toEqual({ posicion: 4, ciclo: 1, fecha: '2026-03-02', tbd: false });
    expect(parsearTarjeta('5 TBD')).toEqual({ posicion: 5, ciclo: null, fecha: null, tbd: true });
    expect(parsearTarjeta("2 9/'7/25")).toEqual({
      posicion: 2,
      ciclo: null,
      fecha: '2025-07-09',
      tbd: false,
    });
    expect(parsearTarjeta('BUEN FIN')).toEqual({ etiqueta: 'BUEN FIN' });
    expect(parsearTarjeta('11 1/1/26')).toBeNull(); // fuera de 1..10
    expect(parsearTarjeta('0 1/1/26')).toBeNull();
    expect(parsearTarjeta('2 31/2/26')).toEqual({ posicion: 2, ciclo: null, fecha: null, tbd: false });
    expect(parsearTarjeta(null)).toBeNull();
  });

  it('M-10 RESTA: toma el último monto', () => {
    expect(restaDeComentario('01sep. compran / 25sep. transfieren 500 y se toman 73. RESTA 66')).toBe(6600);
    expect(restaDeComentario('RESTA 100 / … RESTA 25.50')).toBe(2550);
    expect(restaDeComentario('resta $1,250')).toBe(125000);
    expect(restaDeComentario('sin abonos')).toBeNull();
  });

  it('M-11 estatus: clasifica por llave normalizada; sin clasificar → null', () => {
    expect(clasificarEstatus('Vendido', mapeo)).toBe('vendido');
    expect(clasificarEstatus('  POR  cobrar ', mapeo)).toBe('por_cobrar');
    expect(clasificarEstatus('¿Qué es esto?', mapeo)).toBeNull();
    expect(clasificarEstatus(null, mapeo)).toBeNull();
  });

  it('M-12 proveedor: canónico por llave, desconocido tal cual, números o direcciones → null + aviso', () => {
    expect(proveedorCanonico(' PROV  Uno ', mapeo)).toEqual({ nombre: 'Proveedor Uno', aviso: null });
    expect(proveedorCanonico('Otro Proveedor', mapeo)).toEqual({ nombre: 'Otro Proveedor', aviso: null });
    expect(proveedorCanonico(null, mapeo)).toEqual({ nombre: null, aviso: null });
    expect(proveedorCanonico(12345, mapeo).nombre).toBeNull();
    expect(proveedorCanonico(12345, mapeo).aviso).toEqual(expect.any(String));
    const dir = proveedorCanonico('Calle Falsa 123, Col. Centro', mapeo);
    expect(dir.nombre).toBeNull();
    expect(dir.aviso).toEqual(expect.any(String));
  });

  it('M-13 categoría: primera palabra en singular → mapeo; sin coincidencia → categoriaSinDato', () => {
    expect(categoriaDeDescripcion('Pulsera de plata', mapeo)).toBe('Pulseras');
    expect(categoriaDeDescripcion('Huggies dorados', mapeo)).toBe('Huggies');
    expect(categoriaDeDescripcion('COLLAR', mapeo)).toBe('Collares');
    expect(categoriaDeDescripcion('Cosa rara', mapeo)).toBe('Sin categoría (histórico)');
    expect(categoriaDeDescripcion('', mapeo)).toBe('Sin categoría (histórico)');
  });

  it('M-14 similitud: palabras de 3+ letras compartidas / mínimo de ambos', () => {
    expect(similitud('Ana Maria Lopez', 'ana lopez')).toBe(1);
    expect(similitud('Ana Maria Lopez', 'Maria Perez')).toBe(0.5);
    expect(similitud('Ana', 'Beto')).toBe(0);
    expect(similitud('Al', 'Al')).toBe(0);
    expect(similitud('', 'Ana')).toBe(0);
  });
});

describe('ids deterministas', () => {
  it('misma clave, mismo uuid; formato uuid válido', () => {
    const a = uuidDeterminista('excel-f1', 'inv:ZZ01');
    expect(a).toBe(uuidDeterminista('excel-f1', 'inv:ZZ01'));
    expect(a).not.toBe(uuidDeterminista('excel-f1', 'inv:ZZ02'));
    expect(a).not.toBe(uuidDeterminista('excel-f2', 'inv:ZZ01'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('jsonCanonico ordena llaves, omite undefined y rechaza no finitos', () => {
    expect(jsonCanonico({ b: 1, a: [2, { d: null, c: undefined }] })).toBe('{"a":[2,{"d":null}],"b":1}');
    expect(() => jsonCanonico({ x: Number.NaN })).toThrow(TypeError);
    expect(() => jsonCanonico({ x: Infinity })).toThrow(TypeError);
  });

  it('hashPlan no depende del orden de las llaves', () => {
    expect(hashPlan({ a: 1, b: 2 })).toBe(hashPlan({ b: 2, a: 1 }));
    expect(hashPlan({ a: 1 })).not.toBe(hashPlan({ a: 2 }));
    expect(hashPlan({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
