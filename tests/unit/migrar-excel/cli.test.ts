import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ErrorVerificacion, type ResultadoBd } from '../../../scripts/migrar-excel/aplicar';
import { ejecutar, ErrorCli, parsearArgumentos, type Dependencias } from '../../../scripts/migrar-excel/cli';
import { leerLibros } from '../../../scripts/migrar-excel/leer';
import { planificar } from '../../../scripts/migrar-excel/planificar';
import type { Libro } from '../../../scripts/migrar-excel/tipos';
import { fecha, filaConc, filaInv, librosSinteticos } from '../../apoyo/libro-sintetico';
import { mapeoSintetico } from '../../apoyo/mapeo-sintetico';

const RUTAS = ['--inventario', 'inv.xlsx', '--tracking', 'tr.xlsx'];

describe('parsearArgumentos', () => {
  it('lee los modos, ignora el "--" de pnpm y aplica los valores por defecto', () => {
    expect(parsearArgumentos(['--', '--modo=simular', ...RUTAS])).toMatchObject({
      modo: 'simular',
      inventario: 'inv.xlsx',
      tracking: 'tr.xlsx',
      mapeo: 'docs/migracion/mapeo.json',
      salida: 'docs/migracion/salida',
      confirmoProduccion: false,
    });
    expect(
      parsearArgumentos(['--modo=aplicar', ...RUTAS, '--plan=abc', '--confirmo-produccion']),
    ).toMatchObject({ modo: 'aplicar', plan: 'abc', confirmoProduccion: true });
  });

  it('rechaza modo desconocido, rutas faltantes, opciones desconocidas y aplicar sin --plan (código 2)', () => {
    const codigo = (argv: string[]) => {
      try {
        parsearArgumentos(argv);
      } catch (e) {
        return e instanceof ErrorCli ? e.codigo : -1;
      }
      return 0;
    };
    expect(codigo(['--modo=borrar', ...RUTAS])).toBe(2);
    expect(codigo(['--modo=ensayo', '--inventario', 'a.xlsx'])).toBe(2);
    expect(codigo(['--modo=simular', ...RUTAS, '--borrar'])).toBe(2);
    expect(codigo(['--modo=aplicar', ...RUTAS])).toBe(2);
    expect(codigo(['--modo=ensayo', ...RUTAS])).toBe(0);
  });
});

describe('ejecutar', () => {
  let libro: Libro;
  let hash: string;
  beforeAll(async () => {
    const b = await librosSinteticos({
      inventario: [filaInv({ id: 'ZZ01' })],
      concentrado: [
        filaConc({
          f: fecha(2026, 9, 1),
          venta: 100,
          cliente: 'Clienta Uno',
          estatus: 'Vendido',
          id: 'AB01',
          desc: 'Anillo',
        }),
      ],
    });
    libro = await leerLibros({ ...b, hojasExhibidor: [] });
    hash = planificar(libro, mapeoSintetico()).hash;
  });

  const resultado = (modo: 'ensayo' | 'aplicar'): ResultadoBd => ({
    modo,
    insertados: { piezas: 2 },
    yaAplicados: 0,
    cambiados: [],
    reutilizados: { categorias: 0, materiales: 0, proveedores: 0, vendedores: 0, clientes: 0 },
    rechazosEnBd: [],
    verificacion: { ok: true, diferencias: [] },
    siguienteFolio: 1,
  });
  function deps(o: { esProduccion?: boolean; aplicar?: Dependencias['aplicarPlan'] } = {}) {
    const d = {
      leerArchivos: vi.fn(async () => libro),
      cargarMapeo: vi.fn(async () => mapeoSintetico()),
      prepararDestino: vi.fn(() => ({ url: 'postgres://x', esProduccion: o.esProduccion ?? false })),
      aplicarPlan: vi.fn(o.aplicar ?? (async (_u, _p, x) => resultado(x.modo))),
      escribirReporte: vi.fn<Dependencias['escribirReporte']>(async (dir) => [`${dir}/reporte.md`]),
      exigirIgnorado: vi.fn(),
      escribirMapeoSugerido: vi.fn(async () => 'docs/migracion/mapeo.sugerido.json'),
      log: vi.fn(),
    } satisfies Dependencias;
    return d;
  }

  it('simular no llama a la guarda ni a la BD', async () => {
    const d = deps();
    expect(await ejecutar(['--modo=simular', ...RUTAS], d)).toBe(0);
    expect(d.prepararDestino).not.toHaveBeenCalled();
    expect(d.aplicarPlan).not.toHaveBeenCalled();
    expect(d.escribirReporte).toHaveBeenCalledOnce();
    expect(d.log.mock.calls.flat().join('\n')).toContain(hash);
  });

  it('ensayo pasa por la guarda, aplica en modo ensayo y escribe el reporte con el resultado de la BD', async () => {
    const d = deps();
    expect(await ejecutar(['--modo=ensayo', ...RUTAS], d)).toBe(0);
    expect(d.prepararDestino).toHaveBeenCalledWith('DATABASE_URL_OWNER', expect.stringContaining('ensayo'));
    expect(d.aplicarPlan).toHaveBeenCalledWith('postgres://x', expect.anything(), { modo: 'ensayo' });
    expect(d.escribirReporte.mock.calls[0]![1]).toMatchObject({
      modo: 'ensayo',
      hash,
      bd: resultado('ensayo'),
    });
  });

  it('aplicar con un hash distinto al calculado termina con código 3 sin tocar la BD', async () => {
    const d = deps();
    expect(await ejecutar(['--modo=aplicar', ...RUTAS, '--plan=otro'], d)).toBe(3);
    expect(d.log.mock.calls.flat().join('\n')).toContain('El plan cambió desde el reporte aprobado');
    expect(d.aplicarPlan).not.toHaveBeenCalled();
  });

  it('aplicar en producción sin --confirmo-produccion termina con código 4', async () => {
    const d = deps({ esProduccion: true });
    expect(await ejecutar(['--modo=aplicar', ...RUTAS, `--plan=${hash}`], d)).toBe(4);
    expect(d.prepararDestino).toHaveBeenCalled();
    expect(d.aplicarPlan).not.toHaveBeenCalled();
    const d2 = deps({ esProduccion: true });
    expect(await ejecutar(['--modo=aplicar', ...RUTAS, `--plan=${hash}`, '--confirmo-produccion'], d2)).toBe(
      0,
    );
    expect(d2.aplicarPlan).toHaveBeenCalledWith('postgres://x', expect.anything(), { modo: 'aplicar' });
  });

  it('si la verificación no cuadra: código 5, reporte con las diferencias y la consola solo con el conteo', async () => {
    const malo = {
      ...resultado('aplicar'),
      verificacion: { ok: false, diferencias: ['saldo del cliente x'] },
    };
    const d = deps({
      aplicar: async () => {
        throw new ErrorVerificacion(['saldo del cliente x'], malo);
      },
    });
    expect(await ejecutar(['--modo=aplicar', ...RUTAS, `--plan=${hash}`], d)).toBe(5);
    expect(d.escribirReporte.mock.calls[0]![1]).toMatchObject({ bd: malo });
    expect(d.log.mock.calls.flat().join('\n')).not.toContain('saldo del cliente x');
  });
});
