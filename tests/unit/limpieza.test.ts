import { describe, expect, it } from 'vitest';
import { autorizarLimpieza, parsearArgsLimpieza } from '../../scripts/lib/limpieza';

const base = {
  esProduccion: false,
  esDevelopment: false,
  otraBd: false,
  ramas: ['production', 'development'],
};

describe('autorizarLimpieza', () => {
  it('producción: exige --confirmo-produccion y --respaldo con una rama existente (no production/development)', () => {
    const prod = { ...base, esProduccion: true, otraBd: true };
    expect(() => autorizarLimpieza(prod, parsearArgsLimpieza([]))).toThrow(/confirmo-produccion/);
    expect(() => autorizarLimpieza(prod, parsearArgsLimpieza(['--confirmo-produccion']))).toThrow(/respaldo/);
    expect(() =>
      autorizarLimpieza(prod, parsearArgsLimpieza(['--confirmo-produccion', '--respaldo=no-existe'])),
    ).toThrow(/no existe/);
    expect(() =>
      autorizarLimpieza(prod, parsearArgsLimpieza(['--confirmo-produccion', '--respaldo=production'])),
    ).toThrow(/respaldo/);
    const conRespaldo = { ...prod, ramas: [...base.ramas, 'respaldo-1'] };
    expect(() =>
      autorizarLimpieza(conRespaldo, parsearArgsLimpieza(['--confirmo-produccion', '--respaldo=respaldo-1'])),
    ).not.toThrow();
  });

  it('development: exige --confirmo-development', () => {
    const dev = { ...base, esDevelopment: true, otraBd: true };
    expect(() => autorizarLimpieza(dev, parsearArgsLimpieza([]))).toThrow(/confirmo-development/);
    expect(() => autorizarLimpieza(dev, parsearArgsLimpieza(['--confirmo-development']))).not.toThrow();
  });

  it('cualquier otra base: exige KAZERO_OTRA_BD=confirmo', () => {
    expect(() => autorizarLimpieza(base, parsearArgsLimpieza([]))).toThrow(/KAZERO_OTRA_BD/);
    expect(() => autorizarLimpieza({ ...base, otraBd: true }, parsearArgsLimpieza([]))).not.toThrow();
  });

  it('rechaza opciones desconocidas', () => {
    expect(() => parsearArgsLimpieza(['--todo'])).toThrow();
  });
});
