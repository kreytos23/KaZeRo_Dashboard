import { describe, expect, it, vi } from 'vitest';
import { ErrorPlanTarjetas } from '../../../scripts/importar-tarjetas/bd';
import { ejecutarTarjetas, type DependenciasTarjetas } from '../../../scripts/importar-tarjetas/cli';

const plan = { crear: [], actualizar: [], sinCambios: 0, errores: [], vendedoras: [], hash: 'abc' };
function deps(produccion: boolean): DependenciasTarjetas & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    leerArchivo: async () => ({ filas: [], sha256: 'x' }),
    prepararDestino: () => ({
      url: 'postgres://u@h/db',
      esProduccion: produccion,
      host: 'h',
      baseDatos: 'db',
    }),
    simular: vi.fn(async () => plan),
    aplicar: vi.fn(async () => ({ plan, creadas: 0, actualizadas: 0 })),
    ramas: () => [],
    hostProduccionNeon: () => 'postgres://u@h/db',
    ahora: () => new Date(),
    log: (m) => logs.push(m),
  };
}

describe('CLI de tarjetas', () => {
  it('aplicar sin --plan no escribe', async () => {
    const d = deps(false);
    expect(await ejecutarTarjetas(['aplicar', 'x.xlsx'], d)).toBe(2);
    expect(d.aplicar).not.toHaveBeenCalled();
  });
  it('aplicar en producción sin respaldo no escribe', async () => {
    const d = deps(true);
    expect(await ejecutarTarjetas(['aplicar', 'x.xlsx', '--plan=abc'], d)).toBe(4);
    expect(d.aplicar).not.toHaveBeenCalled();
  });
  it('ensayo llama a aplicar en modo ensayo y sale con 0', async () => {
    const d = deps(false);
    expect(await ejecutarTarjetas(['ensayo', 'x.xlsx'], d)).toBe(0);
    expect(d.aplicar).toHaveBeenCalledWith(expect.any(String), [], {
      modo: 'ensayo',
      hashEsperado: undefined,
    });
  });
  it('aplicar que lanza ErrorPlanTarjetas sale con 6', async () => {
    const d = deps(false);
    d.aplicar = vi.fn(async () => {
      throw new ErrorPlanTarjetas('El plan cambió.', plan);
    });
    expect(await ejecutarTarjetas(['aplicar', 'x.xlsx', '--plan=abc'], d)).toBe(6);
  });
  it('simular con un plan con errores sale con 6', async () => {
    const d = deps(false);
    d.simular = vi.fn(async () => ({ ...plan, errores: ['fila 4: algo'] }));
    expect(await ejecutarTarjetas(['simular', 'x.xlsx'], d)).toBe(6);
  });
  it('aplicar en producción con un respaldo que no existe sale con 4 sin aplicar', async () => {
    const d = deps(true);
    expect(
      await ejecutarTarjetas(
        ['aplicar', 'x.xlsx', '--plan=abc', '--confirmo-produccion', '--respaldo=no-existe'],
        d,
      ),
    ).toBe(4);
    expect(d.aplicar).not.toHaveBeenCalled();
  });
  it('simular no aplica', async () => {
    const d = deps(true);
    expect(await ejecutarTarjetas(['simular', 'x.xlsx'], d)).toBe(0);
    expect(d.aplicar).not.toHaveBeenCalled();
  });
});
