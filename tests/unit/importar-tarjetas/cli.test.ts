import { describe, expect, it, vi } from 'vitest';
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
  it('simular no aplica', async () => {
    const d = deps(true);
    expect(await ejecutarTarjetas(['simular', 'x.xlsx'], d)).toBe(0);
    expect(d.aplicar).not.toHaveBeenCalled();
  });
});
