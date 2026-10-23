import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { vPedido, vSaldoFavor } from '@/db/schema';
import { crearCliente } from '@/server/clientes/servicio';
import { crearExhibidor, enviarPiezas, regresarPiezas } from '@/server/exhibidores/servicio';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza, historial, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
let adminId = '';
let ctx: { clienteId: string; vendedorId: string };

async function alta(codigo: string, precioCentavos = 14900) {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Collares',
      descripcion: `Collar ${codigo}`,
      costoCentavos: 0,
      precioCentavos,
    }),
  );
  return codigo;
}
const crear = (codigos: string[]) =>
  app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      ...ctx,
      codigos,
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
    }),
  );
const ficha = (id: string) =>
  app(async (db) => (await db.select().from(vPedido).where(eq(vPedido.id, id)))[0]!);
async function cancelar(id: string, motivo = 'Ya no la quiere', key = randomUUID()) {
  const { version } = await ficha(id);
  return app((db) => cancelarPedido(db, { key, adminId, pedidoId: id, version, motivo }));
}

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  ctx = {
    vendedorId: await app((db) =>
      crearVendedor(db, { nombre: 'Zeltzin', tipo: 'revendedora', comisionPct: '15.00' }),
    ),
    clienteId: await app((db) => crearCliente(db, { nombre: 'Rocío' })),
  };
});

describe('cancelarPedido', () => {
  it('R-17: las piezas vuelven a disponible, el pedido queda cancelado con motivo y saldo 0', async () => {
    const p = await crear([await alta('CA01'), await alta('CA02')]);
    expect(await cancelar(p.id)).toEqual({ liberadas: 2, alExhibidor: 0, saldoFavor: '0.00' });
    expect(await ficha(p.id)).toMatchObject({
      estado: 'cancelado',
      cancelacionMotivo: 'Ya no la quiere',
      saldo: '0.00',
    });
    const pz = (await app((db) => obtenerPiezaPorCodigo(db, 'CA01')))!;
    expect(pz.estado).toBe('disponible');
    expect((await app((db) => historial(db, pz.id)))[0]).toMatchObject({
      tipo: 'liberacion',
      deEstado: 'apartada',
      aEstado: 'disponible',
    });
    // Las piezas pueden entrar a otro pedido (la línea ya no es vigente).
    await crear(['CA01']);
  });

  it('las líneas quedan no vigentes con su fecha de salida', async () => {
    const p = await crear([await alta('CA12')]);
    await cancelar(p.id);
    const f = await app((db) =>
      db.execute(
        sql`SELECT vigente, quitado_at IS NOT NULL AS quitado FROM v_pedido_item WHERE pedido_id = ${p.id}`,
      ),
    );
    expect(f.rows).toEqual([{ vigente: false, quitado: true }]);
  });

  it('R-17: una pieza de exhibidor abierto regresa a ese exhibidor', async () => {
    const codigo = await alta('CA03');
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: 'Z1', fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: [codigo] }));
    const p = await crear([codigo]);
    expect(await cancelar(p.id)).toMatchObject({ liberadas: 1, alExhibidor: 1 });
    expect((await app((db) => obtenerPiezaPorCodigo(db, codigo)))!).toMatchObject({
      estado: 'en_exhibidor',
      exhibidorId,
    });
  });

  it('D-12: si el exhibidor está cerrado (dato viejo), la pieza queda disponible y la nota lo explica', async () => {
    const codigo = await alta('CA04');
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: 'Z2', fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: [codigo] }));
    const p = await crear([codigo]);
    // cerrarExhibidor lo impediría (tiene una apartada): se fuerza como dueño para simular datos viejos.
    await conDbUrl(urlOwner(), (db) =>
      db.execute(sql`UPDATE exhibidor SET estado = 'cerrado', cerrado_at = now() WHERE id = ${exhibidorId}`),
    );
    expect(await cancelar(p.id)).toMatchObject({ liberadas: 1, alExhibidor: 0 });
    const pz = (await app((db) => obtenerPiezaPorCodigo(db, codigo)))!;
    expect(pz).toMatchObject({ estado: 'disponible', exhibidorId: null });
    expect((await app((db) => historial(db, pz.id)))[0]!.nota).toMatch(
      /El exhibidor está cerrado: queda disponible\.$/,
    );
  });

  it('R-17 + P2: lo abonado pasa a saldo a favor de cada pagador y las aplicaciones se anulan', async () => {
    const p = await crear([await alta('CA05', 30000)]);
    const pagar = (montoCentavos: number, pagador: 'cliente' | 'vendedor') =>
      app((db) =>
        registrarPagoDePedido(db, {
          key: randomUUID(),
          adminId,
          pedidoId: p.id,
          montoCentavos,
          metodo: 'efectivo',
          pagador,
        }),
      );
    await pagar(10000, 'cliente');
    await pagar(5000, 'vendedor');
    expect(await cancelar(p.id)).toMatchObject({ saldoFavor: '150.00' });
    expect(await ficha(p.id)).toMatchObject({ pagado: '0.00', saldo: '0.00' });
    const saldos = await app((db) => db.select().from(vSaldoFavor));
    expect(saldos).toEqual(
      expect.arrayContaining([
        { clienteId: ctx.clienteId, vendedorId: null, saldo: '100.00' },
        { clienteId: null, vendedorId: ctx.vendedorId, saldo: '50.00' },
      ]),
    );
    const anuladas = await app((db) =>
      db.execute(
        sql`SELECT count(*)::int AS n FROM v_aplicacion_pago WHERE pedido_id = ${p.id} AND anulada_at IS NOT NULL`,
      ),
    );
    expect(anuladas.rows[0]).toEqual({ n: 2 });
  });

  it('R-18: un pedido liquidado no se cancela', async () => {
    const p = await crear([await alta('CA06', 0)]); // total 0 → liquidado (D-8)
    await expect(cancelar(p.id)).rejects.toThrow(
      'Un pedido liquidado no se cancela: primero revierte sus pagos.',
    );
  });

  it('exige motivo, rechaza versión vieja y doble cancelación', async () => {
    const p = await crear([await alta('CA07')]);
    await expect(cancelar(p.id, '  ')).rejects.toThrow(
      'Escribe el motivo de la cancelación (hasta 200 caracteres).',
    );
    await expect(
      app((db) =>
        cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: p.id, version: 999, motivo: 'x' }),
      ),
    ).rejects.toThrow('Otra pestaña modificó este registro. Recarga la página.');
    await cancelar(p.id);
    await expect(cancelar(p.id)).rejects.toThrow('El pedido ya está cancelado.');
  });

  it('R-24 + R-29: al cancelar la #5 con saldo, la siguiente nueva toma la 5', async () => {
    for (const c of ['L1', 'L2', 'L3', 'L4']) await crear([await alta(c, 0)]); // 4 liquidadas
    const cinco = await crear([await alta('CA08')]);
    expect(cinco.posicion).toEqual({ ciclo: 1, posicion: 5 });
    await cancelar(cinco.id);
    const otra = await crear([await alta('CA09')]);
    // Sin otra nota con saldo: recupera el 10 %.
    expect(otra).toMatchObject({ posicion: { ciclo: 1, posicion: 5 }, pctBps: 1000 });
  });

  it('R-24: cancelar una posición intermedia deja un hueco que la siguiente nota llena', async () => {
    const a = await crear([await alta('CH1')]);
    const b = await crear([await alta('CH2', 0)]);
    const c = await crear([await alta('CH3', 0)]);
    expect([a.posicion?.posicion, b.posicion?.posicion, c.posicion?.posicion]).toEqual([1, 2, 3]);
    await cancelar(a.id);
    const d = await crear([await alta('CH4', 0)]);
    expect(d.posicion).toEqual({ ciclo: 1, posicion: 1 });
  });

  it('R-29 derogada: una nota con saldo, cancelada o no, no quita el 10 % del lugar 5', async () => {
    for (const c of ['S1', 'S2', 'S3', 'S4']) await crear([await alta(c, 0)]); // 4 liquidadas
    // Nota abierta con saldo que no cuenta para la tarjeta.
    const a = await app(async (db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        ...ctx,
        codigos: [await alta('CS1')],
        cuentaTarjeta: false,
        descuentoManualCentavos: 0,
      }),
    );
    const cinco = await crear([await alta('CS2')]);
    expect(cinco).toMatchObject({ posicion: { ciclo: 1, posicion: 5 }, pctBps: 1000 });
    // Cancelar el lugar 5 deshace su descuento: el siguiente pedido vuelve a ser el lugar 5 con 10 %.
    await cancelar(cinco.id);
    await cancelar(a.id);
    const siguiente = await crear([await alta('CS3')]);
    expect(siguiente).toMatchObject({ posicion: { ciclo: 1, posicion: 5 }, pctBps: 1000 });
  });

  it('R-37: la misma key cancela una sola vez y devuelve el mismo resultado', async () => {
    const p = await crear([await alta('CA10')]);
    const { version } = await ficha(p.id);
    const key = randomUUID();
    const una = () => app((db) => cancelarPedido(db, { key, adminId, pedidoId: p.id, version, motivo: 'x' }));
    const [a, b] = await Promise.all([una(), una()]);
    expect(a).toEqual(b);
  });

  it('la bitácora registra la cancelación con su motivo y el admin (Plan 2.1)', async () => {
    const p = await crear([await alta('CA11')]);
    await cancelar(p.id, 'Cambio de talla');
    const f = await app((db) =>
      db.execute(sql`SELECT campo, antes, despues, motivo, admin_email FROM v_auditoria
        WHERE entidad = 'pedido' AND entidad_id = ${p.id} ORDER BY posicion`),
    );
    expect(f.rows).toEqual([
      {
        campo: 'estado',
        antes: 'abierto',
        despues: 'cancelado',
        motivo: 'Cambio de talla',
        admin_email: 'auditor@kazero.test',
      },
      {
        campo: 'cancelacion_motivo',
        antes: null,
        despues: 'Cambio de talla',
        motivo: 'Cambio de talla',
        admin_email: 'auditor@kazero.test',
      },
    ]);
  });

  it('concurrencia: cancelar y pagar el mismo pedido termina consistente, sin errores crudos', async () => {
    let acumulado = 0; // el saldo a favor del cliente se acumula entre rondas
    const p = await crear([await alta(`CC0`, 30000)]);
    const { version } = await ficha(p.id);
    const r = await Promise.allSettled([
      app((db) =>
        registrarPagoDePedido(db, {
          key: randomUUID(),
          adminId,
          pedidoId: p.id,
          montoCentavos: 10000,
          metodo: 'efectivo',
          pagador: 'cliente',
        }),
      ),
      app((db) => cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: p.id, version, motivo: 'x' })),
    ]);
    for (const x of r)
      if (x.status === 'rejected') {
        const e = x.reason as { name?: string; code?: string };
        expect(e.name).toBe('ErrorNegocio');
        expect(e.code).not.toBe('40P01');
      }
    const f = await ficha(p.id);
    const pagoOk = r[0].status === 'fulfilled';
    const cancelOk = r[1].status === 'fulfilled';
    if (cancelOk) {
      expect(f).toMatchObject({ estado: 'cancelado', pagado: '0.00', saldo: '0.00' });
      if (pagoOk) acumulado += 10000;
      const saldos = await app((db) => db.select().from(vSaldoFavor));
      expect(saldos.find((s) => s.clienteId === ctx.clienteId)?.saldo ?? '0.00').toBe(
        (acumulado / 100).toFixed(2),
      );
    } else {
      // La versión quedó vieja por el pago: se rechaza con conflicto y el pedido sigue abierto.
      expect(pagoOk).toBe(true);
      expect(f).toMatchObject({ estado: 'abierto', pagado: '100.00' });
    }
  });

  it('concurrencia: cancelar y regresar otra pieza del mismo exhibidor no interbloquea (40P01)', async () => {
    const [a, b, c] = [await alta(`CE0A`), await alta(`CE0B`), await alta(`CE0C`)];
    const exhibidorId = await app((db) =>
      crearExhibidor(db, { vendedorId: ctx.vendedorId, nombre: `E0`, fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: [a, b] }));
    const p = await crear([a]);
    const { version } = await ficha(p.id);
    const r = await Promise.allSettled([
      app((db) => cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: p.id, version, motivo: 'x' })),
      app((db) => regresarPiezas(db, { exhibidorId, codigos: [b] })),
      app((db) => enviarPiezas(db, { exhibidorId, codigos: [c] })),
    ]);
    for (const x of r)
      if (x.status === 'rejected') expect((x.reason as { code?: string }).code).not.toBe('40P01');
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(await app((db) => obtenerPiezaPorCodigo(db, a))).toMatchObject({
      estado: 'en_exhibidor',
      exhibidorId,
    });
  });
});
