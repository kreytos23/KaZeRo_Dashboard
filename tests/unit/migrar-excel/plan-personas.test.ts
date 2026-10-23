import { describe, expect, it } from 'vitest';
import { leerLibros } from '../../../scripts/migrar-excel/leer';
import { planPersonas } from '../../../scripts/migrar-excel/plan-personas';
import { nuevoContexto } from '../../../scripts/migrar-excel/tipos';
import {
  fecha,
  filaConc,
  filaInv,
  librosSinteticos,
  type DatosSinteticos,
} from '../../apoyo/libro-sintetico';
import { mapeoSintetico } from '../../apoyo/mapeo-sintetico';

async function planear(d: DatosSinteticos, extra: Record<string, unknown> = {}) {
  const b = await librosSinteticos(d);
  const ctx = nuevoContexto();
  const m = mapeoSintetico(extra);
  const p = planPersonas(await leerLibros({ ...b, hojasExhibidor: [] }), m, ctx);
  return { p, ctx, m };
}
const venta = (cliente: string, extra: Partial<Parameters<typeof filaConc>[0]> = {}) =>
  filaConc({
    f: fecha(2026, 5, 2),
    venta: 100,
    cliente,
    estatus: 'Vendido',
    id: 'ZZ01',
    desc: 'Anillo',
    ...extra,
  });

describe('planPersonas', () => {
  it('M-24 el prefijo de vendedor sale del nombre; un prefijo que no es vendedor es referencia', async () => {
    const { p } = await planear({
      concentrado: [venta('Vend A - Clienta Uno'), venta('Amiga - Clienta Dos'), venta('Clienta Uno')],
    });
    expect(p.clientes.map((c) => c.nombre).sort()).toEqual(['Clienta Dos', 'Clienta Uno']);
    expect(p.clientes.find((c) => c.nombre === 'Clienta Dos')).toMatchObject({ referencia: 'Amiga' });
    const vendA = p.vendedores.find((v) => v.nombre === 'Vendedora A')!;
    expect(p.clientes.find((c) => c.nombre === 'Clienta Uno')!.vendedorHabitualId).toBe(vendA.id);
    expect(p.filaCliente.get(3)).toMatchObject({ vendedorId: vendA.id });
    expect(p.vendedores.map((v) => v.comisionPct)).toEqual(['0.00', '15.00', '15.00']);
  });

  it('M-24 fusión automática solo con la misma llave; las parecidas son candidatas, no una palabra', async () => {
    const { p } = await planear({
      concentrado: [
        venta('Clienta  UNO.'),
        venta('clienta uno'),
        venta('Maria Lopez'),
        venta('Maria Lopez Ruiz'),
        venta('Ana'),
        venta('Ana Perez'),
      ],
    });
    expect(p.clientes.filter((c) => c.llave === 'clienta uno')).toHaveLength(1);
    expect(p.clientes).toHaveLength(5);
    expect(p.candidatasFusion).toEqual([['maria lopez', 'maria lopez ruiz']]);
  });

  it('M-24 mapeo.fusiones une y mapeo.noFusionar separa', async () => {
    const filas = [venta('Maria Lopez'), venta('Maria Lopez Ruiz')];
    const unidas = await planear({ concentrado: filas }, { fusiones: [['Maria Lopez', 'Maria Lopez Ruiz']] });
    expect(unidas.p.clientes).toHaveLength(1);
    expect(unidas.p.candidatasFusion).toEqual([]);
    expect(unidas.p.filaCliente.get(3)!.clienteId).toBe(unidas.p.filaCliente.get(4)!.clienteId);
    const separadas = await planear(
      { concentrado: filas },
      { noFusionar: [['Maria Lopez', 'Maria Lopez Ruiz']] },
    );
    expect(separadas.p.clientes).toHaveLength(2);
    expect(separadas.p.candidatasFusion).toEqual([]);
  });

  it('M-25 cumpleaños: el bloque A pone red y usuario; si no casa se crea el cliente con nota', async () => {
    const { p } = await planear({
      concentrado: [venta('Clienta Uno'), venta('Clienta Dos')],
      cumpleA: [
        ['IG', 'clienta.uno', fecha(2024, 3, 5)],
        ['FB', 'usuario.nuevo', fecha(2024, 2, 29)],
      ],
      cumpleB: [
        ['Clienta Dos', fecha(2024, 7, 1)],
        ['Clienta Cinco', null],
      ],
      lealtad: [['Clienta Seis', fecha(2026, 1, 10)]],
    });
    const uno = p.clientes.find((c) => c.nombre === 'Clienta Uno')!;
    expect(uno).toMatchObject({
      redSocial: 'Instagram',
      usuarioRed: 'clienta.uno',
      cumpleanos: '2024-03-05',
    });
    expect(uno.notas).toContain('Año de cumpleaños desconocido');
    expect(p.clientes.find((c) => c.nombre === 'Clienta Dos')!.cumpleanos).toBe('2024-07-01');
    const nuevo = p.clientes.find((c) => c.usuarioRed === 'usuario.nuevo')!;
    expect(nuevo).toMatchObject({ redSocial: 'Facebook', cumpleanos: '2024-02-29' });
    expect(nuevo.notas).toContain('Solo en Cumpleaños (Excel)');
    expect(p.clientes.find((c) => c.nombre === 'Clienta Cinco')).toMatchObject({ cumpleanos: null });
    expect(p.clientes.find((c) => c.nombre === 'Clienta Seis')!.notas).toContain(
      'Solo en Tarjeta de Lealtad (Excel)',
    );
  });

  it('M-26 un prefijo desconocido que aparece en Comisión es un vendedor sin mapeo: rechazo; si no, referencia', async () => {
    const { p, ctx } = await planear({
      concentrado: [
        venta('Vendedora Z - Clienta Uno', { com: '15% Vendedora Z - sep' }),
        venta('Amiga - Clienta Dos'),
        venta('VEND  a - Clienta Tres'),
        venta('Clienta Cuatro', { com: '18% Vend A - jul' }),
      ],
    });
    expect(ctx.rechazos).toEqual([
      expect.objectContaining({ hoja: 'Concentrado', fila: 3, motivo: 'vendedor sin mapeo' }),
    ]);
    expect(ctx.filasRechazadas.has(3)).toBe(true);
    expect(p.clientes.map((c) => c.nombre).sort()).toEqual(['Clienta Cuatro', 'Clienta Dos', 'Clienta Tres']);
    const vendA = p.vendedores.find((v) => v.nombre === 'Vendedora A')!;
    expect(p.filaCliente.get(5)!.vendedorId).toBe(vendA.id); // alias sin distinguir mayúsculas ni espacios
    expect(p.filaCliente.get(6)!.vendedorId).toBe(vendA.id); // vendedor tomado de la columna Comisión
  });

  it('el cliente del inventario se une por llave y el genérico se crea solo si se pide', async () => {
    const { p } = await planear({
      inventario: [filaInv({ id: 'ZZ01', cliente: 'Clienta Uno', vend: 'Vend A' })],
      concentrado: [venta('Clienta Uno')],
    });
    expect(p.clientes).toHaveLength(1);
    expect(p.filaClienteInv.get(2)).toMatchObject({ clienteId: p.clientes[0]!.id });
    const g = p.clienteGenerico();
    expect(p.clientes.find((c) => c.id === g)!.nombre).toBe('Sin cliente (histórico)');
    expect(p.clienteGenerico()).toBe(g);
    expect(p.clientes).toHaveLength(2);
  });
});
