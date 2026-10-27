import { describe, expect, it, vi } from 'vitest';
import {
  ejecutar,
  parsearArgumentos,
  validarRespaldo,
  type Dependencias,
  type EnsayoGuardado,
} from '../../../scripts/importar-kzr/cli';
import { ErrorPlanCambio, type ResultadoKzr } from '../../../scripts/importar-kzr/bd';
import type { RamaNeon } from '../../../scripts/lib/neon';
import type { PlanKzr } from '../../../scripts/importar-kzr/tipos';

const AHORA = new Date('2026-10-26T12:00:00Z');
const rama = (name: string, id: string, parentId: string | null, createdAt: string | null): RamaNeon => ({
  id,
  name,
  parentId,
  createdAt,
});
const RAMAS = [
  rama('production', 'br-prod', null, '2026-01-01T00:00:00Z'),
  rama('development', 'br-dev', 'br-prod', '2026-01-02T00:00:00Z'),
  rama('respaldo-1', 'br-r1', 'br-prod', '2026-10-26T08:00:00Z'),
];
const plan = (errores: PlanKzr['errores'] = []): PlanKzr => ({
  clientesPorCrear: [],
  notas: [],
  errores,
  avisos: [],
  siguienteFolio: 1,
  hash: 'h'.repeat(64),
});
const resultado = (): ResultadoKzr => ({
  modo: 'ensayo',
  plan: plan(),
  insertados: { pedidos: 0, items: 0, piezasApartadas: 0, movimientos: 0, origen: 0, clientes: 0 },
  yaAplicadas: 0,
  verificacion: { ok: true, diferencias: [] },
  siguienteFolio: 1,
});

function deps(extra: Partial<Dependencias> & { produccion?: boolean; ensayo?: EnsayoGuardado | null } = {}) {
  const log: string[] = [];
  const guardados: EnsayoGuardado[] = [];
  const d: Dependencias = {
    leerArchivo: async () => ({ filas: [], sha256: 'abc' }),
    prepararDestino: () => ({
      url: 'postgres://x',
      esProduccion: extra.produccion ?? false,
      host: 'h',
      baseDatos: 'b',
    }),
    simular: vi.fn(async () => plan()),
    aplicar: vi.fn(async () => resultado()),
    ramas: () => RAMAS,
    hostProduccionNeon: () => 'h',
    ahora: () => AHORA,
    leerEnsayo: async () => extra.ensayo ?? null,
    guardarEnsayo: async (_r, x) => void guardados.push(x),
    exigirIgnorado: () => undefined,
    hoy: () => '2026-10-26',
    log: (m) => void log.push(m),
    ...extra,
  };
  return { d, log, guardados };
}

describe('parsearArgumentos', () => {
  it('modo y archivo posicionales; aplicar exige --plan', () => {
    expect(parsearArgumentos(['simular', 'a.xlsx'])).toMatchObject({ modo: 'simular', archivo: 'a.xlsx' });
    expect(() => parsearArgumentos(['aplicar', 'a.xlsx'])).toThrow(/--plan/);
    expect(
      parsearArgumentos(['aplicar', 'a.xlsx', '--plan=abc', '--confirmo-produccion', '--respaldo=r']),
    ).toMatchObject({ plan: 'abc', confirmoProduccion: true, respaldo: 'r' });
  });
  it('rechaza modo desconocido, archivo faltante y opciones desconocidas', () => {
    expect(() => parsearArgumentos(['borrar', 'a.xlsx'])).toThrow(/Uso/);
    expect(() => parsearArgumentos(['simular'])).toThrow(/Uso/);
    expect(() => parsearArgumentos(['simular', 'a.xlsx', '--x'])).toThrow();
  });
});

describe('ejecutar', () => {
  it('simular: usa solo simular (nunca aplicar) y sale 0; con errores sale 6', async () => {
    const { d } = deps();
    expect(await ejecutar(['simular', 'a.xlsx'], d)).toBe(0);
    expect(d.simular).toHaveBeenCalledOnce();
    expect(d.aplicar).not.toHaveBeenCalled();
    const { d: d2 } = deps({
      simular: vi.fn(async () => plan([{ codigo: 'pieza_faltante', folio: 1, filas: [2], mensaje: 'x' }])),
    });
    expect(await ejecutar(['simular', 'a.xlsx'], d2)).toBe(6);
  });
  it('ensayo: guarda el marcador con el hash del plan', async () => {
    const { d, guardados } = deps();
    expect(await ejecutar(['ensayo', 'a.xlsx'], d)).toBe(0);
    expect(guardados).toEqual([expect.objectContaining({ hashPlan: 'h'.repeat(64) })]);
  });
  it('aplicar sin ensayo previo del mismo plan → 2 y no escribe', async () => {
    const { d } = deps({ ensayo: null });
    expect(await ejecutar(['aplicar', 'a.xlsx', '--plan=' + 'h'.repeat(64)], d)).toBe(2);
    expect(d.aplicar).not.toHaveBeenCalled();
    const { d: d2 } = deps({ ensayo: { hashPlan: 'otro', fecha: '' } });
    expect(await ejecutar(['aplicar', 'a.xlsx', '--plan=' + 'h'.repeat(64)], d2)).toBe(2);
    expect(d2.aplicar).not.toHaveBeenCalled();
  });
  it('aplicar con ensayo del mismo plan: aplica con el hash esperado', async () => {
    const hash = 'h'.repeat(64);
    const { d } = deps({ ensayo: { hashPlan: hash, fecha: '' } });
    expect(await ejecutar(['aplicar', 'a.xlsx', `--plan=${hash}`], d)).toBe(0);
    expect(d.aplicar).toHaveBeenCalledWith(
      'postgres://x',
      [],
      expect.objectContaining({ modo: 'aplicar', hashEsperado: hash }),
    );
  });
  it('producción: aplicar exige --confirmo-produccion y un respaldo que exista (código 4)', async () => {
    const hash = 'h'.repeat(64);
    const ensayo = { hashPlan: hash, fecha: '' };
    const base = ['aplicar', 'a.xlsx', `--plan=${hash}`];
    for (const extra of [
      [],
      ['--confirmo-produccion'],
      ['--confirmo-produccion', '--respaldo=nada'],
      ['--confirmo-produccion', '--respaldo=development'],
    ]) {
      const { d } = deps({ produccion: true, ensayo });
      expect(await ejecutar([...base, ...extra], d)).toBe(4);
      expect(d.aplicar).not.toHaveBeenCalled();
    }
    const { d } = deps({ produccion: true, ensayo });
    expect(await ejecutar([...base, '--confirmo-produccion', '--respaldo=respaldo-1'], d)).toBe(0);
    expect(d.aplicar).toHaveBeenCalledOnce();
  });
  it('el plan cambió → 3', async () => {
    const { d } = deps({
      aplicar: vi.fn(async () => {
        throw new ErrorPlanCambio('a', 'b');
      }),
    });
    expect(await ejecutar(['ensayo', 'a.xlsx', '--plan=a'], d)).toBe(3);
  });
});

describe('validarRespaldo', () => {
  const c = {
    ahora: AHORA,
    hostDestino: 'ep-x-pooler.region.neon.tech',
    hostProduccionNeon: 'ep-x.region.neon.tech',
  };
  it('acepta un respaldo reciente, hijo de production y del mismo proyecto', () => {
    expect(() => validarRespaldo(RAMAS, 'respaldo-1', c)).not.toThrow();
  });
  it('rechaza: otro proyecto, no existe, padre distinto de production, muy viejo o sin fecha', () => {
    expect(() =>
      validarRespaldo(RAMAS, 'respaldo-1', { ...c, hostProduccionNeon: 'otro.neon.tech' }),
    ).toThrow(/proyecto/);
    expect(() => validarRespaldo(RAMAS, 'nada', c)).toThrow(/no existe/);
    const deDev = [...RAMAS, rama('r-dev', 'br-2', 'br-dev', '2026-10-26T08:00:00Z')];
    expect(() => validarRespaldo(deDev, 'r-dev', c)).toThrow(/production/);
    const viejo = [...RAMAS, rama('r-viejo', 'br-3', 'br-prod', '2026-10-24T08:00:00Z')];
    expect(() => validarRespaldo(viejo, 'r-viejo', c)).toThrow(/24 h/);
    const sinFecha = [...RAMAS, rama('r-sf', 'br-4', 'br-prod', null)];
    expect(() => validarRespaldo(sinFecha, 'r-sf', c)).toThrow(/24 h/);
    const raiz = [...RAMAS, rama('r-raiz', 'br-5', null, '2026-10-26T08:00:00Z')];
    expect(() => validarRespaldo(raiz, 'r-raiz', c)).toThrow(/production/);
  });
});
