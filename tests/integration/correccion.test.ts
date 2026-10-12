import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { exhibidor, pieza } from '@/db/schema';
import {
  cerrarExhibidor,
  crearExhibidor,
  enviarPiezas,
  obtenerExhibidor,
  regresarPiezas,
} from '@/server/exhibidores/servicio';
import {
  altaPieza,
  cambiarEstado,
  deshacerUltimoCambio,
  historial,
  obtenerPiezaPorCodigo,
} from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { adminDePrueba, truncarTodo, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const ficha = (codigo = 'CO01') => app((db) => obtenerPiezaPorCodigo(db, codigo)).then((f) => f!);

let adminId: string;
beforeEach(async () => {
  await truncarTodo();
  adminId = await adminDePrueba();
});

async function nueva(codigo = 'CO01') {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Anillos',
      descripcion: 'Anillo',
      costoCentavos: 0,
      precioCentavos: 14900,
    }),
  );
  return ficha(codigo);
}
async function exhibidorCon(...codigos: string[]) {
  const vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' }),
  );
  const exhibidorId = await app((db) =>
    crearExhibidor(db, { vendedorId, nombre: 'Exh Nelly', fechaEnvio: '2026-10-11' }),
  );
  await app((db) => enviarPiezas(db, { exhibidorId, codigos }));
  return exhibidorId;
}
async function marcar(codigo: string, aEstado: 'regalo' | 'defecto' | 'guardada') {
  const p = await ficha(codigo);
  await app((db) => cambiarEstado(db, { piezaId: p.id, version: p.version, aEstado, adminId }));
  return ficha(codigo);
}
const deshacer = (p: { id: string; version: number }, motivo = 'Se marcó por error') =>
  app((db) => deshacerUltimoCambio(db, { piezaId: p.id, version: p.version, adminId, motivo }));

/**
 * Mantiene el exhibidor bloqueado (NO KEY UPDATE) en otra conexión, lanza las operaciones en el orden
 * dado esperando a que cada una quede en espera de un bloqueo, y luego suelta el exhibidor. Así el orden
 * de llegada a los bloqueos es determinista (sin depender de la suerte del planificador).
 */
async function enFila<T extends unknown[]>(
  exhibidorId: string,
  ops: { [K in keyof T]: () => Promise<T[K]> },
): Promise<PromiseSettledResult<unknown>[]> {
  const lanzadas: Promise<unknown>[] = [];
  await conDbUrl(urlApp(), (db) =>
    db.transaction(async (tx) => {
      await tx
        .select({ id: exhibidor.id })
        .from(exhibidor)
        .where(eq(exhibidor.id, exhibidorId))
        .for('no key update');
      for (const op of ops) {
        const esperando = lanzadas.length + 1;
        const p = op();
        p.catch(() => undefined);
        lanzadas.push(p);
        const limite = Date.now() + 15000;
        for (;;) {
          const r = await tx.execute<{ n: number }>(
            // Esperar una fila bloqueada es esperar el transactionid de quien la tiene (sin `database`):
            // se cuentan los procesos en espera, no los bloqueos.
            sql`SELECT count(DISTINCT pid)::int AS n FROM pg_locks WHERE NOT granted`,
          );
          if (r.rows[0]!.n >= esperando) break;
          if (Date.now() > limite) throw new Error('La operación no llegó a esperar el bloqueo');
          await new Promise((res) => setTimeout(res, 50));
        }
      }
    }),
  );
  return Promise.allSettled(lanzadas);
}

describe('deshacer el último cambio manual (R-07)', () => {
  it('regalo desde disponible vuelve a disponible; queda como corrección con motivo y admin', async () => {
    await nueva();
    const p = await marcar('CO01', 'regalo');
    expect(await deshacer(p)).toEqual({
      codigo: 'CO01',
      aEstado: 'disponible',
      exhibidorNombre: null,
      exhibidorCerrado: false,
    });
    expect(await ficha()).toMatchObject({ estado: 'disponible', version: p.version + 1 });
    const [ultimo, previo] = await app((db) => historial(db, p.id));
    expect(ultimo).toMatchObject({
      tipo: 'correccion',
      deEstado: 'regalo',
      aEstado: 'disponible',
      nota: 'Se marcó por error',
      adminEmail: 'auditor@kazero.test',
    });
    // El cambio manual también guarda quién lo hizo.
    expect(previo).toMatchObject({
      tipo: 'cambio_estado',
      aEstado: 'regalo',
      adminEmail: 'auditor@kazero.test',
    });
  });

  it('defecto desde un exhibidor abierto vuelve al mismo exhibidor', async () => {
    await nueva();
    const exhibidorId = await exhibidorCon('CO01');
    const p = await marcar('CO01', 'defecto');
    expect(await deshacer(p)).toMatchObject({
      aEstado: 'en_exhibidor',
      exhibidorNombre: 'Exh Nelly',
      exhibidorCerrado: false,
    });
    expect(await ficha()).toMatchObject({ estado: 'en_exhibidor', exhibidorId });
    expect((await app((db) => obtenerExhibidor(db, exhibidorId)))!.piezasActuales).toBe(1);
    const [ultimo] = await app((db) => historial(db, p.id));
    expect(ultimo).toMatchObject({
      tipo: 'correccion',
      deEstado: 'defecto',
      aEstado: 'en_exhibidor',
      exhibidorId,
      exhibidorEstado: 'abierto',
    });
  });

  it('si el exhibidor ya se cerró, vuelve a disponible y lo avisa', async () => {
    await nueva();
    const exhibidorId = await exhibidorCon('CO01');
    const p = await marcar('CO01', 'guardada');
    const e = (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
    await app((db) => cerrarExhibidor(db, { exhibidorId, version: e.version }));
    expect(await deshacer(p)).toMatchObject({
      aEstado: 'disponible',
      exhibidorNombre: 'Exh Nelly',
      exhibidorCerrado: true,
    });
    expect(await ficha()).toMatchObject({ estado: 'disponible', exhibidorId: null });
  });

  it('exige motivo de 1 a 200 caracteres', async () => {
    await nueva();
    const p = await marcar('CO01', 'regalo');
    await expect(deshacer(p, '   ')).rejects.toMatchObject({ codigo: 'motivo', campo: 'motivo' });
    await expect(deshacer(p, 'x'.repeat(201))).rejects.toMatchObject({ codigo: 'motivo', campo: 'motivo' });
    expect((await ficha()).estado).toBe('regalo');
    expect(await deshacer(p, 'x'.repeat(200))).toMatchObject({ aEstado: 'disponible' });
  });

  it('solo el último movimiento y solo si fue manual: tras una corrección ya no hay nada que deshacer', async () => {
    const recien = await nueva();
    await expect(deshacer(recien)).rejects.toMatchObject({ codigo: 'correccion_no_disponible' });
    const p = await marcar('CO01', 'regalo');
    await deshacer(p);
    await expect(deshacer(await ficha())).rejects.toMatchObject({ codigo: 'correccion_no_disponible' });
  });

  it('no aplica a un cambio manual hacia disponible', async () => {
    await nueva();
    const d = await marcar('CO01', 'defecto');
    await app((db) =>
      cambiarEstado(db, { piezaId: d.id, version: d.version, aEstado: 'disponible', adminId }),
    );
    await expect(deshacer(await ficha())).rejects.toMatchObject({ codigo: 'correccion_no_disponible' });
  });

  it('no aplica a piezas apartadas ni vendidas', async () => {
    const p = await nueva();
    for (const estado of ['apartada', 'vendida'] as const) {
      await conDbUrl(urlOwner(), (db) => db.update(pieza).set({ estado }).where(eq(pieza.id, p.id)));
      await expect(deshacer(p)).rejects.toMatchObject({ codigo: 'correccion_no_disponible' });
    }
  });

  it('versión vieja → conflicto y no escribe nada', async () => {
    await nueva();
    const p = await marcar('CO01', 'regalo');
    await expect(deshacer({ id: p.id, version: p.version - 1 })).rejects.toThrow(
      'Otra pestaña modificó este registro',
    );
    expect((await app((db) => historial(db, p.id)))[0]!.tipo).toBe('cambio_estado');
  });

  it('dos correcciones a la vez: una gana y la otra recibe conflicto', async () => {
    await nueva();
    const p = await marcar('CO01', 'regalo');
    const r = await Promise.allSettled([deshacer(p, 'Pestaña 1'), deshacer(p, 'Pestaña 2')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((x) => x.status === 'rejected')).toMatchObject({ reason: { codigo: 'conflicto' } });
    expect((await app((db) => historial(db, p.id))).filter((m) => m.tipo === 'correccion')).toHaveLength(1);
  });

  it('dos correcciones del exhibidor a la vez (en fila): una gana, la otra conflicto', async () => {
    await nueva();
    const exhibidorId = await exhibidorCon('CO01');
    const p = await marcar('CO01', 'regalo');
    const r = await enFila(exhibidorId, [() => deshacer(p, 'Pestaña 1'), () => deshacer(p, 'Pestaña 2')]);
    expect(r[0]).toMatchObject({ status: 'fulfilled', value: { aEstado: 'en_exhibidor' } });
    expect(r[1]).toMatchObject({ status: 'rejected', reason: { codigo: 'conflicto' } });
  });
});

describe('corrección concurrente con exhibidores (orden exhibidor → pieza)', () => {
  it('regresarPiezas llega primero y la corrección después: sin interbloqueo, un resultado coherente', async () => {
    await nueva('CO01');
    await nueva('CO02');
    const exhibidorId = await exhibidorCon('CO01', 'CO02');
    const p = await marcar('CO01', 'regalo');
    // regresar bloquea el exhibidor y espera la pieza; si la corrección bloqueara la pieza antes que el
    // exhibidor, quedarían en espera cruzada (40P01).
    const [regreso, correccion] = await enFila(exhibidorId, [
      () => app((db) => regresarPiezas(db, { exhibidorId, codigos: ['CO01', 'CO02'] })),
      () => deshacer(p),
    ]);
    expect(regreso).toMatchObject({ status: 'rejected', reason: { codigo: 'regreso_rechazado' } });
    expect(correccion).toMatchObject({ status: 'fulfilled', value: { aEstado: 'en_exhibidor' } });
    expect(await ficha('CO01')).toMatchObject({ estado: 'en_exhibidor', exhibidorId });
    expect((await ficha('CO02')).estado).toBe('en_exhibidor');
  });

  it('la corrección llega primero y regresar después: la pieza vuelve al exhibidor y luego regresa', async () => {
    await nueva('CO01');
    const exhibidorId = await exhibidorCon('CO01');
    const p = await marcar('CO01', 'defecto');
    const [correccion, regreso] = await enFila(exhibidorId, [
      () => deshacer(p),
      () => app((db) => regresarPiezas(db, { exhibidorId, codigos: ['CO01'] })),
    ]);
    expect(correccion).toMatchObject({ status: 'fulfilled', value: { aEstado: 'en_exhibidor' } });
    expect(regreso).toMatchObject({ status: 'fulfilled', value: { regresadas: 1 } });
    expect(await ficha('CO01')).toMatchObject({ estado: 'disponible', exhibidorId: null });
    const tipos = (await app((db) => historial(db, p.id))).map((m) => m.tipo);
    expect(tipos.slice(0, 2)).toEqual(['regreso', 'correccion']);
  });

  it('enviarPiezas y la corrección en el mismo exhibidor: sin interbloqueo', async () => {
    await nueva('CO01');
    await nueva('CO02');
    const exhibidorId = await exhibidorCon('CO01');
    const p = await marcar('CO01', 'guardada');
    const [envio, correccion] = await enFila(exhibidorId, [
      () => app((db) => enviarPiezas(db, { exhibidorId, codigos: ['CO02'] })),
      () => deshacer(p),
    ]);
    expect(envio).toMatchObject({ status: 'fulfilled', value: { enviadas: 1 } });
    expect(correccion).toMatchObject({ status: 'fulfilled', value: { aEstado: 'en_exhibidor' } });
    expect((await app((db) => obtenerExhibidor(db, exhibidorId)))!.piezasActuales).toBe(2);
  });

  it('el exhibidor se cierra mientras la corrección espera: vuelve a disponible y lo avisa', async () => {
    await nueva('CO01');
    const exhibidorId = await exhibidorCon('CO01');
    const p = await marcar('CO01', 'regalo');
    const e = (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
    const [cierre, correccion] = await enFila(exhibidorId, [
      () => app((db) => cerrarExhibidor(db, { exhibidorId, version: e.version })),
      () => deshacer(p),
    ]);
    expect(cierre).toMatchObject({ status: 'fulfilled' });
    expect(correccion).toMatchObject({
      status: 'fulfilled',
      value: { aEstado: 'disponible', exhibidorNombre: 'Exh Nelly', exhibidorCerrado: true },
    });
    expect(await ficha('CO01')).toMatchObject({ estado: 'disponible', exhibidorId: null });
  });

  it('la corrección gana al cierre: el cierre se rechaza porque la pieza volvió', async () => {
    await nueva('CO01');
    const exhibidorId = await exhibidorCon('CO01');
    const p = await marcar('CO01', 'regalo');
    const e = (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
    const [correccion, cierre] = await enFila(exhibidorId, [
      () => deshacer(p),
      () => app((db) => cerrarExhibidor(db, { exhibidorId, version: e.version })),
    ]);
    expect(correccion).toMatchObject({ status: 'fulfilled', value: { aEstado: 'en_exhibidor' } });
    expect(cierre).toMatchObject({ status: 'rejected', reason: { codigo: 'exhibidor_con_piezas' } });
  });
});
