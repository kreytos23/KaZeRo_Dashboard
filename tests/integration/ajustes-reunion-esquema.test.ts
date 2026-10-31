import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl, type Db, type Ejecutor } from '@/db/pool';
import { pgCode, pgConstraint } from '@/db/errors';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

// Plan 3.1 (0016/0017): custodia de vendedora, devoluciones y saldo a favor. Todo en SQL directo (sin
// servicios) para probar solo la BD, como pedidos-esquema.test.ts. Como kazero_app salvo donde se indica.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const app = <T>(fn: (db: Db) => Promise<T>) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: (db: Db) => Promise<T>) => conDbUrl(urlOwner(), fn);
const enTx = <T>(fn: (tx: Tx) => Promise<T>) => app((db) => db.transaction(fn));
const q = (s: SQL) => app((db) => db.execute(s));
async function idDe(ej: Ejecutor, s: SQL) {
  const r = await ej.execute<{ id: string }>(s);
  return r.rows[0]!.id;
}
/** 'ok', o el nombre de la constraint violada (o el SQLSTATE si no trae nombre). */
async function resultado(fn: () => Promise<unknown>) {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    return pgConstraint(e) ?? pgCode(e) ?? 'sin-codigo';
  }
}

let adminId = '';
let b: { clienteId: string; casaId: string; perlaId: string; olgaId: string; categoriaId: string };

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  b = await app(async (db) => ({
    clienteId: await idDe(db, sql`INSERT INTO cliente (nombre) VALUES ('Gloria') RETURNING id`),
    casaId: await idDe(db, sql`INSERT INTO vendedor (nombre, tipo) VALUES ('Kazero', 'casa') RETURNING id`),
    perlaId: await idDe(
      db,
      sql`INSERT INTO vendedor (nombre, tipo) VALUES ('Perla', 'revendedora') RETURNING id`,
    ),
    olgaId: await idDe(
      db,
      sql`INSERT INTO vendedor (nombre, tipo) VALUES ('Olga', 'revendedora') RETURNING id`,
    ),
    categoriaId: await idDe(db, sql`INSERT INTO categoria (nombre) VALUES ('Anillos') RETURNING id`),
  }));
});

const nuevaPieza = (codigo: string, precio = '149.00') =>
  app(async (db) => {
    const id = await idDe(
      db,
      sql`INSERT INTO pieza (codigo, categoria_id, descripcion, precio, fecha_alta)
          VALUES (${codigo}, ${b.categoriaId}, 'Anillo', ${precio}, '2026-10-01') RETURNING id`,
    );
    await db.execute(
      sql`INSERT INTO movimiento_pieza (pieza_id, tipo, a_estado, admin_id) VALUES (${id}, 'alta', 'disponible', ${adminId})`,
    );
    return id;
  });

type ExtraMov = { pedidoId?: string; vendedorId?: string; exhibidorId?: string; nota?: string };
const mov = (ej: Ejecutor, piezaId: string, tipo: string, de: string, a: string, x: ExtraMov = {}) =>
  ej.execute(sql`INSERT INTO movimiento_pieza (pieza_id, tipo, de_estado, a_estado, pedido_id, vendedor_id, exhibidor_id, nota, admin_id)
    VALUES (${piezaId}, ${tipo}, ${de}, ${a}, ${x.pedidoId ?? null}, ${x.vendedorId ?? null}, ${x.exhibidorId ?? null},
            ${x.nota ?? null}, ${adminId})`);

/** Como lo hará el servicio: primero la pieza, después su movimiento, en la misma transacción. */
const entregar = (piezaId: string, vendedorId: string) =>
  enTx(async (tx) => {
    await tx.execute(sql`UPDATE pieza SET vendedor_custodia_id = ${vendedorId} WHERE id = ${piezaId}`);
    await mov(tx, piezaId, 'entrega_vendedora', 'disponible', 'disponible', { vendedorId });
  });
const regresar = (piezaId: string, vendedorId: string) =>
  enTx(async (tx) => {
    await tx.execute(sql`UPDATE pieza SET vendedor_custodia_id = NULL WHERE id = ${piezaId}`);
    await mov(tx, piezaId, 'regreso_vendedora', 'disponible', 'disponible', { vendedorId });
  });

const nuevoPedido = (o: { estado?: 'abierto' | 'liquidado'; total?: string; fecha?: string } = {}) => {
  const estado = o.estado ?? 'liquidado';
  return app((db) =>
    idDe(
      db,
      sql`INSERT INTO pedido (cliente_id, vendedor_id, admin_id, fecha, total, estado, liquidado_at, cuenta_tarjeta)
          VALUES (${b.clienteId}, ${b.casaId}, ${adminId}, ${o.fecha ?? '2026-10-10'}, ${o.total ?? '149.00'},
                  ${estado}, ${estado === 'liquidado' ? sql`now()` : null}, false) RETURNING id`,
    ),
  );
};

/** Línea + apartado + venta (Plan 3). La venta saca la pieza de la custodia. Devuelve el id de la línea. */
const vender = (piezaId: string, pedidoId: string, precio = '149.00') =>
  enTx(async (tx) => {
    const itemId = await idDe(
      tx,
      sql`INSERT INTO pedido_item (pedido_id, pieza_id, precio_lista, precio_final)
          VALUES (${pedidoId}, ${piezaId}, ${precio}, ${precio}) RETURNING id`,
    );
    await tx.execute(sql`UPDATE pieza SET estado = 'apartada' WHERE id = ${piezaId}`);
    await mov(tx, piezaId, 'apartado', 'disponible', 'apartada', { pedidoId });
    await tx.execute(
      sql`UPDATE pieza SET estado = 'vendida', vendedor_custodia_id = NULL WHERE id = ${piezaId}`,
    );
    await mov(tx, piezaId, 'venta', 'apartada', 'vendida', { pedidoId });
    return itemId;
  });

const insertarDevolucion = (ej: Ejecutor, itemId: string, monto: string, fecha = '2026-10-15') =>
  idDe(
    ej,
    sql`INSERT INTO devolucion (pedido_item_id, fecha, motivo, monto, admin_id)
        VALUES (${itemId}, ${fecha}, 'Se rompió el broche', ${monto}, ${adminId}) RETURNING id`,
  );

type Sfm = {
  tipo: string;
  monto: string;
  pedidoId?: string | null;
  aplicacionPagoId?: string;
  devolucionId?: string;
  adminId?: string | null;
  nota?: string;
  vendedorId?: string;
  pagoId?: string;
};
const saldoMov = (ej: Ejecutor, v: Sfm) =>
  ej.execute(sql`INSERT INTO saldo_favor_mov (cliente_id, vendedor_id, tipo, monto, pedido_id, aplicacion_pago_id,
      devolucion_id, admin_id, nota, fecha, pago_id)
    VALUES (${v.vendedorId ? null : b.clienteId}, ${v.vendedorId ?? null}, ${v.tipo}, ${v.monto}, ${v.pedidoId ?? null},
            ${v.aplicacionPagoId ?? null}, ${v.devolucionId ?? null},
            ${v.adminId === undefined ? adminId : v.adminId}, ${v.nota ?? null}, '2026-10-15', ${v.pagoId ?? null})`);

/** Flujo completo de una devolución (Task 6): devolución + saldo + línea fuera + pieza a defecto + movimiento. */
const devolver = (itemId: string, piezaId: string, pedidoId: string, monto = '149.00') =>
  enTx(async (tx) => {
    const devId = await insertarDevolucion(tx, itemId, monto);
    await saldoMov(tx, { tipo: 'devolucion', monto, pedidoId, devolucionId: devId });
    await tx.execute(sql`UPDATE pedido_item SET vigente = false WHERE id = ${itemId}`);
    await tx.execute(sql`UPDATE pieza SET estado = 'defecto' WHERE id = ${piezaId}`);
    await mov(tx, piezaId, 'devolucion', 'vendida', 'defecto', { pedidoId });
    return devId;
  });

const nuevoPago = (ej: Ejecutor, metodo: string, monto: string, o: { vendedor?: boolean } = {}) =>
  idDe(
    ej,
    sql`INSERT INTO pago (idempotency_key, fecha, monto, metodo, pagador_cliente_id, pagador_vendedor_id, admin_id)
        VALUES (${randomUUID()}, '2026-10-12', ${monto}, ${metodo}, ${o.vendedor ? null : b.clienteId},
                ${o.vendedor ? b.perlaId : null}, ${adminId}) RETURNING id`,
  );
const aplicar = (ej: Ejecutor, pagoId: string, pedidoId: string, monto: string) =>
  idDe(
    ej,
    sql`INSERT INTO aplicacion_pago (pago_id, pedido_id, monto, fecha)
        VALUES (${pagoId}, ${pedidoId}, ${monto}, '2026-10-12') RETURNING id`,
  );

describe('ubicación de la pieza: custodia de vendedora (D-8, D-9)', () => {
  it('pieza_una_ubicacion y pieza_custodia_solo_si_aplica (CHECK)', async () => {
    const [ex] = (
      await q(
        sql`INSERT INTO exhibidor (vendedor_id, nombre, fecha_envio) VALUES (${b.perlaId}, 'Feria', '2026-10-01') RETURNING id`,
      )
    ).rows as { id: string }[];
    const alta = (estado: string, exhibidorId: string | null, custodiaId: string | null) =>
      resultado(() =>
        q(sql`INSERT INTO pieza (codigo, categoria_id, descripcion, precio, fecha_alta, estado, exhibidor_id, vendedor_custodia_id)
              VALUES (${'X' + estado.slice(0, 3).toUpperCase()}, ${b.categoriaId}, 'Anillo', '10', '2026-10-01', ${estado},
                      ${exhibidorId}, ${custodiaId})`),
      );
    // Una pieza nueva siempre nace en Kazero (trigger pieza_alta_sin_custodia): se entrega después del alta.
    expect(await alta('disponible', null, b.perlaId)).toBe('pieza_alta_custodia');
    expect(await alta('vendida', null, b.perlaId)).toBe('pieza_alta_custodia');
    // Por UPDATE: un cambio manual que conserva la vendedora choca con el CHECK.
    const p = await nuevaPieza('AF20');
    await entregar(p, b.perlaId);
    expect(await resultado(() => q(sql`UPDATE pieza SET estado = 'regalo' WHERE id = ${p}`))).toBe(
      'pieza_custodia_solo_si_aplica',
    );
    // Defensa en profundidad: con la guarda del alta apagada (como dueño, en una transacción que se deshace),
    // el CHECK pieza_una_ubicacion y el movimiento 'alta' siguen rechazando.
    const vistos: string[] = [];
    const deshacer = new Error('deshacer');
    let salida: unknown = null;
    try {
      await owner((db) =>
        db.transaction(async (tx) => {
          await tx.execute(sql`ALTER TABLE pieza DISABLE TRIGGER pieza_alta_sin_custodia`);
          const intento = async (s: SQL) => {
            try {
              await tx.transaction((t2) => t2.execute(s));
              vistos.push('ok');
            } catch (e) {
              vistos.push(pgConstraint(e) ?? pgCode(e) ?? 'sin-codigo');
            }
          };
          await intento(sql`INSERT INTO pieza (codigo, categoria_id, descripcion, precio, fecha_alta, estado, exhibidor_id, vendedor_custodia_id)
            VALUES ('XB01', ${b.categoriaId}, 'Anillo', '10', '2026-10-01', 'apartada', ${ex!.id}, ${b.perlaId})`);
          const id = await idDe(
            tx,
            sql`INSERT INTO pieza (codigo, categoria_id, descripcion, precio, fecha_alta, vendedor_custodia_id)
                VALUES ('XC01', ${b.categoriaId}, 'Anillo', '10', '2026-10-01', ${b.perlaId}) RETURNING id`,
          );
          await intento(
            sql`INSERT INTO movimiento_pieza (pieza_id, tipo, a_estado, admin_id) VALUES (${id}, 'alta', 'disponible', ${adminId})`,
          );
          throw deshacer;
        }),
      );
    } catch (e) {
      salida = e;
    }
    expect(salida).toBe(deshacer);
    expect(vistos).toEqual(['pieza_una_ubicacion', 'movimiento_coherente']);
  });

  it('regreso_vendedora: solo deshace la entrega vigente (no se repite ni se inventa)', async () => {
    const p = await nuevaPieza('AF21');
    expect(await resultado(() => regresar(p, b.perlaId))).toBe('movimiento_coherente');
    await entregar(p, b.perlaId);
    expect(await resultado(() => regresar(p, b.perlaId))).toBe('ok');
    expect(await resultado(() => regresar(p, b.perlaId))).toBe('movimiento_coherente');
    // Entregada y luego sacada de la custodia por un cambio manual (D-12): ya no hay entrega que regresar.
    await entregar(p, b.olgaId);
    await enTx(async (tx) => {
      await tx.execute(
        sql`UPDATE pieza SET estado = 'guardada', vendedor_custodia_id = NULL WHERE id = ${p}`,
      );
      await mov(tx, p, 'cambio_estado', 'disponible', 'guardada', { vendedorId: b.olgaId });
    });
    await enTx(async (tx) => {
      await tx.execute(sql`UPDATE pieza SET estado = 'disponible' WHERE id = ${p}`);
      await mov(tx, p, 'cambio_estado', 'guardada', 'disponible');
    });
    expect(await resultado(() => regresar(p, b.olgaId))).toBe('movimiento_coherente');
  });

  it('pieza_cambio_custodia: nunca de una vendedora a otra, ni ganarla o perderla estando apartada', async () => {
    const p1 = await nuevaPieza('AF12');
    expect(await resultado(() => entregar(p1, b.perlaId))).toBe('ok');
    expect(
      await resultado(() => q(sql`UPDATE pieza SET vendedor_custodia_id = ${b.olgaId} WHERE id = ${p1}`)),
    ).toBe('pieza_cambio_custodia');
    // Apartada conserva la vendedora: no la pierde...
    const ped = await nuevoPedido({ estado: 'abierto' });
    await enTx(async (tx) => {
      await tx.execute(sql`UPDATE pieza SET estado = 'apartada' WHERE id = ${p1}`);
      await mov(tx, p1, 'apartado', 'disponible', 'apartada', { pedidoId: ped });
    });
    expect(await resultado(() => q(sql`UPDATE pieza SET vendedor_custodia_id = NULL WHERE id = ${p1}`))).toBe(
      'pieza_cambio_custodia',
    );
    // ... y cancelar la regresa a disponible CON ella.
    await enTx(async (tx) => {
      await tx.execute(sql`UPDATE pieza SET estado = 'disponible' WHERE id = ${p1}`);
      await mov(tx, p1, 'liberacion', 'apartada', 'disponible', { pedidoId: ped });
    });
    // ... ni la gana: solo una pieza disponible en Kazero se entrega.
    const p2 = await nuevaPieza('AF13');
    await enTx(async (tx) => {
      await tx.execute(sql`UPDATE pieza SET estado = 'apartada' WHERE id = ${p2}`);
      await mov(tx, p2, 'apartado', 'disponible', 'apartada', { pedidoId: ped });
    });
    expect(
      await resultado(() => q(sql`UPDATE pieza SET vendedor_custodia_id = ${b.perlaId} WHERE id = ${p2}`)),
    ).toBe('pieza_cambio_custodia');
    expect(await resultado(() => regresar(p1, b.perlaId))).toBe('ok');
    // Un cambio manual (defecto) la saca de la custodia.
    await entregar(p1, b.olgaId);
    expect(
      await resultado(() =>
        enTx(async (tx) => {
          await tx.execute(
            sql`UPDATE pieza SET estado = 'defecto', vendedor_custodia_id = NULL WHERE id = ${p1}`,
          );
          await mov(tx, p1, 'cambio_estado', 'disponible', 'defecto', { vendedorId: b.olgaId });
        }),
      ),
    ).toBe('ok');
  });

  it('movimiento_coherente: entrega y regreso con la vendedora correcta', async () => {
    const p = await nuevaPieza('AF12');
    const entregaCon = (custodia: string, enMovimiento: string | undefined) =>
      resultado(() =>
        enTx(async (tx) => {
          await tx.execute(sql`UPDATE pieza SET vendedor_custodia_id = ${custodia} WHERE id = ${p}`);
          await mov(tx, p, 'entrega_vendedora', 'disponible', 'disponible', { vendedorId: enMovimiento });
        }),
      );
    expect(await entregaCon(b.perlaId, b.olgaId)).toBe('movimiento_coherente');
    expect(await entregaCon(b.perlaId, undefined)).toBe('movimiento_coherente');
    // Entrega sin cambiar la custodia (la pieza sigue en Kazero).
    expect(
      await resultado(() =>
        enTx((tx) => mov(tx, p, 'entrega_vendedora', 'disponible', 'disponible', { vendedorId: b.perlaId })),
      ),
    ).toBe('movimiento_coherente');
    await entregar(p, b.perlaId);
    const regresoCon = (vendedorId: string) =>
      resultado(() =>
        enTx(async (tx) => {
          await tx.execute(sql`UPDATE pieza SET vendedor_custodia_id = NULL WHERE id = ${p}`);
          await mov(tx, p, 'regreso_vendedora', 'disponible', 'disponible', { vendedorId });
        }),
      );
    expect(await regresoCon(b.olgaId)).toBe('movimiento_coherente');
    // Regreso que no quita la custodia.
    expect(
      await resultado(() =>
        enTx((tx) => mov(tx, p, 'regreso_vendedora', 'disponible', 'disponible', { vendedorId: b.perlaId })),
      ),
    ).toBe('movimiento_coherente');
    expect(await regresoCon(b.perlaId)).toBe('ok');
  });

  it('movimiento_coherente: un movimiento devolucion exige su devolución registrada', async () => {
    const p = await nuevaPieza('AF12');
    const ped = await nuevoPedido();
    expect(
      await resultado(() =>
        enTx(async (tx) => {
          await tx.execute(sql`UPDATE pieza SET estado = 'defecto' WHERE id = ${p}`);
          await mov(tx, p, 'devolucion', 'disponible', 'defecto', { pedidoId: ped });
        }),
      ),
    ).toBe('movimiento_coherente');
  });

  it('kazero_app puede cambiar la custodia (UPDATE por columna) y v_pieza deriva la ubicación', async () => {
    const enKazero = await nuevaPieza('AA01');
    const conPerla = await nuevaPieza('AA02');
    const enExhibidor = await nuevaPieza('AA03');
    const vendida = await nuevaPieza('AA04');
    await entregar(conPerla, b.perlaId);
    const exId = await app((db) =>
      idDe(
        db,
        sql`INSERT INTO exhibidor (vendedor_id, nombre, fecha_envio) VALUES (${b.olgaId}, 'Feria', '2026-10-01') RETURNING id`,
      ),
    );
    await enTx(async (tx) => {
      await tx.execute(
        sql`UPDATE pieza SET estado = 'en_exhibidor', exhibidor_id = ${exId} WHERE id = ${enExhibidor}`,
      );
      await mov(tx, enExhibidor, 'envio_exhibidor', 'disponible', 'en_exhibidor', { exhibidorId: exId });
    });
    await vender(vendida, await nuevoPedido());
    const r = await q(
      sql`SELECT codigo, ubicacion, vendedor_custodia_id, vendedor_custodia_nombre FROM v_pieza ORDER BY codigo`,
    );
    expect(r.rows).toEqual([
      { codigo: 'AA01', ubicacion: 'kazero', vendedor_custodia_id: null, vendedor_custodia_nombre: null },
      {
        codigo: 'AA02',
        ubicacion: 'vendedora',
        vendedor_custodia_id: b.perlaId,
        vendedor_custodia_nombre: 'Perla',
      },
      { codigo: 'AA03', ubicacion: 'exhibidor', vendedor_custodia_id: null, vendedor_custodia_nombre: null },
      { codigo: 'AA04', ubicacion: 'fuera', vendedor_custodia_id: null, vendedor_custodia_nombre: null },
    ]);
    expect(enKazero).toBeTruthy();
    const m = await q(
      sql`SELECT tipo, vendedor_id, vendedor_nombre FROM v_movimiento_pieza WHERE pieza_id = ${conPerla} ORDER BY orden`,
    );
    expect(m.rows).toEqual([
      { tipo: 'alta', vendedor_id: null, vendedor_nombre: null },
      { tipo: 'entrega_vendedora', vendedor_id: b.perlaId, vendedor_nombre: 'Perla' },
    ]);
  });
});

describe('devolución de una pieza de un pedido liquidado (D-13..D-17)', () => {
  it('movimiento devolucion: solo desde vendida (no se repite tras la devolución)', async () => {
    const p = await nuevaPieza('AF30');
    const ped = await nuevoPedido();
    const item = await vender(p, ped);
    await devolver(item, p, ped);
    expect(
      await resultado(() => enTx((tx) => mov(tx, p, 'devolucion', 'defecto', 'defecto', { pedidoId: ped }))),
    ).toBe('movimiento_coherente');
  });

  it('devolucion_no_es_ultima_venta: la pieza debe estar vendida por ESE pedido', async () => {
    const p = await nuevaPieza('AF31');
    const p1 = await nuevoPedido();
    // La línea de P1 sigue vigente, pero la pieza quedó vendida por otro pedido (sin línea).
    const item = await app((db) =>
      idDe(
        db,
        sql`INSERT INTO pedido_item (pedido_id, pieza_id, precio_lista, precio_final) VALUES (${p1}, ${p}, '149', '149') RETURNING id`,
      ),
    );
    const p2 = await nuevoPedido({ estado: 'abierto' });
    await enTx(async (tx) => {
      await tx.execute(sql`UPDATE pieza SET estado = 'apartada' WHERE id = ${p}`);
      await mov(tx, p, 'apartado', 'disponible', 'apartada', { pedidoId: p2 });
      await tx.execute(sql`UPDATE pieza SET estado = 'vendida' WHERE id = ${p}`);
      await mov(tx, p, 'venta', 'apartada', 'vendida', { pedidoId: p2 });
    });
    expect(
      await resultado(() =>
        enTx(async (tx) => {
          const d = await insertarDevolucion(tx, item, '10.00');
          await saldoMov(tx, { tipo: 'devolucion', monto: '10.00', pedidoId: p1, devolucionId: d });
        }),
      ),
    ).toBe('devolucion_no_es_ultima_venta');
  });

  it('pieza_transicion: vendida → defecto solo con la devolución de su última venta', async () => {
    const p = await nuevaPieza('AF12');
    const ped = await nuevoPedido();
    const item = await vender(p, ped);
    const aDefecto = () => q(sql`UPDATE pieza SET estado = 'defecto' WHERE id = ${p}`);
    expect(await resultado(aDefecto)).toBe('pieza_transicion');
    expect(await resultado(() => devolver(item, p, ped))).toBe('ok');
    // Reparada, se vende otra vez en otro pedido: la devolución vieja no sirve para la venta nueva.
    await enTx(async (tx) => {
      await tx.execute(sql`UPDATE pieza SET estado = 'disponible' WHERE id = ${p}`);
      await mov(tx, p, 'cambio_estado', 'defecto', 'disponible');
    });
    const ped2 = await nuevoPedido();
    await vender(p, ped2);
    expect(await resultado(aDefecto)).toBe('pieza_transicion');
    // Las demás reglas siguen: vendida → regalo no existe.
    expect(await resultado(() => q(sql`UPDATE pieza SET estado = 'regalo' WHERE id = ${p}`))).toBe(
      'pieza_transicion',
    );
  });

  it('devolucion_validar: pedido liquidado, línea vigente, pieza vendida, montos y fecha', async () => {
    // Pedido abierto.
    const pa = await nuevaPieza('AA01');
    const abierto = await nuevoPedido({ estado: 'abierto' });
    const itemAbierto = await app((db) =>
      idDe(
        db,
        sql`INSERT INTO pedido_item (pedido_id, pieza_id, precio_lista, precio_final) VALUES (${abierto}, ${pa}, '149', '149') RETURNING id`,
      ),
    );
    const sinSaldo = (itemId: string, monto: string, fecha?: string) =>
      resultado(() => enTx((tx) => insertarDevolucion(tx, itemId, monto, fecha)));
    expect(await sinSaldo(itemAbierto, '10')).toBe('devolucion_pedido_no_liquidado');
    // Pieza no vendida (la línea es de un pedido liquidado pero la pieza quedó disponible).
    const liq = await nuevoPedido({ total: '100.00' });
    const pb = await nuevaPieza('AA02');
    const itemNoVendida = await app((db) =>
      idDe(
        db,
        sql`INSERT INTO pedido_item (pedido_id, pieza_id, precio_lista, precio_final) VALUES (${liq}, ${pb}, '149', '149') RETURNING id`,
      ),
    );
    expect(await sinSaldo(itemNoVendida, '10')).toBe('devolucion_pieza_no_vendida');
    await q(sql`UPDATE pedido_item SET vigente = false WHERE id = ${itemNoVendida}`);
    expect(await sinSaldo(itemNoVendida, '10')).toBe('devolucion_linea_no_vigente');
    // Montos y fecha.
    const pc = await nuevaPieza('AA03');
    const item = await vender(pc, liq);
    expect(await sinSaldo(item, '149.01')).toBe('devolucion_excede_linea');
    expect(await sinSaldo(item, '120.00')).toBe('devolucion_excede_total');
    expect(await sinSaldo(item, '10.00', '2026-10-09')).toBe('devolucion_fecha');
    expect(await sinSaldo(item, '0')).toBe('devolucion_monto_positivo');
    expect(
      await resultado(() =>
        q(
          sql`INSERT INTO devolucion (pedido_item_id, fecha, motivo, monto, admin_id) VALUES (${item}, '2026-10-15', '  ', '1', ${adminId})`,
        ),
      ),
    ).toBe('devolucion_motivo_largo');
    // Una línea se devuelve una sola vez (aunque siga vigente y el monto alcance).
    await enTx(async (tx) => {
      const d = await insertarDevolucion(tx, item, '10.00');
      await saldoMov(tx, { tipo: 'devolucion', monto: '10.00', pedidoId: liq, devolucionId: d });
    });
    expect(
      await resultado(() =>
        enTx(async (tx) => {
          const d = await insertarDevolucion(tx, item, '10.00');
          await saldoMov(tx, { tipo: 'devolucion', monto: '10.00', pedidoId: liq, devolucionId: d });
        }),
      ),
    ).toBe('devolucion_pedido_item_uq');
  });

  it('las devoluciones no se editan ni se borran; v_pedido y v_pedido_item las muestran', async () => {
    const p = await nuevaPieza('AF12');
    const ped = await nuevoPedido();
    const item = await vender(p, ped);
    const devId = await devolver(item, p, ped, '149.00');
    expect(pgCode(await capturar(() => q(sql`UPDATE devolucion SET motivo = 'x'`)))).toBe('42501');
    expect(pgCode(await capturar(() => q(sql`DELETE FROM devolucion`)))).toBe('42501');
    const v = await q(sql`SELECT estado, total, devuelto, subtotal, piezas FROM v_pedido WHERE id = ${ped}`);
    // D-14: el pedido conserva su historia (la línea devuelta sigue en el subtotal).
    expect(v.rows).toEqual([
      { estado: 'liquidado', total: '149.00', devuelto: '149.00', subtotal: '149.00', piezas: 1 },
    ]);
    const i = await q(
      sql`SELECT vigente, quitado_at, devolucion_id, devolucion_fecha, devolucion_motivo, devolucion_monto
          FROM v_pedido_item WHERE id = ${item}`,
    );
    expect(i.rows).toEqual([
      {
        vigente: false,
        quitado_at: null,
        devolucion_id: devId,
        devolucion_fecha: '2026-10-15',
        devolucion_motivo: 'Se rompió el broche',
        devolucion_monto: '149.00',
      },
    ]);
    const s = await q(
      sql`SELECT tipo, monto, devolucion_id, devolucion_motivo, admin_email FROM v_saldo_favor_mov WHERE cliente_id = ${b.clienteId}`,
    );
    expect(s.rows).toEqual([
      {
        tipo: 'devolucion',
        monto: '149.00',
        devolucion_id: devId,
        devolucion_motivo: 'Se rompió el broche',
        admin_email: 'auditor@kazero.test',
      },
    ]);
    const sinDevolucion = await q(sql`SELECT devuelto FROM v_pedido WHERE id = ${await nuevoPedido()}`);
    expect(sinDevolucion.rows).toEqual([{ devuelto: '0.00' }]);
  });
});

async function capturar(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

describe('libro de saldo a favor v2 (D-20..D-22)', () => {
  it('retiro: nota y admin obligatorios; nunca deja el saldo negativo', async () => {
    const ped = await nuevoPedido();
    await app((db) => saldoMov(db, { tipo: 'cancelacion', monto: '80.00', pedidoId: ped, adminId: null }));
    const retiro = (v: Partial<Sfm>) =>
      resultado(() =>
        app((db) => saldoMov(db, { tipo: 'retiro', monto: '-30.00', nota: 'En efectivo', ...v })),
      );
    expect(await retiro({ nota: undefined })).toBe('saldo_favor_retiro_completo');
    expect(await retiro({ nota: '   ' })).toBe('saldo_favor_retiro_completo');
    expect(await retiro({ adminId: null })).toBe('saldo_favor_retiro_completo');
    expect(await retiro({ nota: 'x'.repeat(201) })).toBe('saldo_favor_nota_largo');
    expect(await retiro({ monto: '30.00' })).toBe('saldo_favor_signo_v2');
    expect(await retiro({ monto: '-100.00' })).toBe('saldo_favor_insuficiente');
    expect(await retiro({})).toBe('ok');
    const r = await q(sql`SELECT saldo FROM v_saldo_favor WHERE cliente_id = ${b.clienteId}`);
    expect(r.rows).toEqual([{ saldo: '50.00' }]);
  });

  it('uso: nace de una aplicación de un pago saldo_favor del mismo titular y por el mismo monto', async () => {
    const ped = await nuevoPedido({ estado: 'abierto' });
    await app((db) => saldoMov(db, { tipo: 'cancelacion', monto: '80.00', pedidoId: ped }));
    expect(
      await resultado(() => app((db) => saldoMov(db, { tipo: 'uso', monto: '-10.00', pedidoId: ped }))),
    ).toBe('saldo_favor_origen');
    // Aplicación de un pago en transferencia: no es saldo.
    const apTransferencia = await enTx(async (tx) =>
      aplicar(tx, await nuevoPago(tx, 'transferencia', '10.00'), ped, '10.00'),
    );
    expect(
      await resultado(() =>
        app((db) =>
          saldoMov(db, { tipo: 'uso', monto: '-10.00', pedidoId: ped, aplicacionPagoId: apTransferencia }),
        ),
      ),
    ).toBe('saldo_favor_uso_incoherente');
    const usar = (montoUso: string, pedidoUso: string | null = ped) =>
      resultado(() =>
        enTx(async (tx) => {
          const ap = await aplicar(tx, await nuevoPago(tx, 'saldo_favor', '50.00'), ped, '50.00');
          await saldoMov(tx, { tipo: 'uso', monto: montoUso, pedidoId: pedidoUso, aplicacionPagoId: ap });
        }),
      );
    expect(await usar('-40.00')).toBe('saldo_favor_uso_incoherente');
    expect(await usar('-50.00', await nuevoPedido())).toBe('saldo_favor_uso_incoherente');
    expect(await usar('-50.00')).toBe('ok');
    // Ya solo quedan 30: otro uso de 50 no alcanza.
    expect(await usar('-50.00')).toBe('saldo_favor_insuficiente');
    const v = await q(sql`SELECT pagado FROM v_pedido WHERE id = ${ped}`);
    expect(v.rows).toEqual([{ pagado: '60.00' }]);
  });

  it('devolucion: el movimiento coincide con su devolución (monto, titular, pedido)', async () => {
    const p = await nuevaPieza('AF12');
    const ped = await nuevoPedido();
    const item = await vender(p, ped);
    const conMonto = (monto: string) =>
      resultado(() =>
        enTx(async (tx) => {
          const d = await insertarDevolucion(tx, item, '149.00');
          await saldoMov(tx, { tipo: 'devolucion', monto, pedidoId: ped, devolucionId: d });
        }),
      );
    expect(await conMonto('100.00')).toBe('saldo_favor_devolucion_incoherente');
    expect(
      await resultado(() => app((db) => saldoMov(db, { tipo: 'devolucion', monto: '10.00', pedidoId: ped }))),
    ).toBe('saldo_favor_origen');
  });

  it('Plan 4b (0024): la vendedora también paga con su saldo (sin pago_saldo_favor_cliente)', async () => {
    // Sin su aplicación completa lo rechaza el diferido pago_saldo_sin_aplicacion, no el CHECK que se quitó.
    expect(
      await resultado(() => app((db) => nuevoPago(db, 'saldo_favor', '10.00', { vendedor: true }))),
    ).toBe('pago_saldo_sin_aplicacion');
  });

  it('compatibilidad: los movimientos de 0012/0013 siguen siendo válidos (sin admin ni nota)', async () => {
    const ped = await nuevoPedido();
    expect(
      await resultado(() =>
        app((db) => saldoMov(db, { tipo: 'cancelacion', monto: '10.00', pedidoId: ped, adminId: null })),
      ),
    ).toBe('ok');
    // Plan 4b (0025): el sobrante nace de su pago (saldo_favor_sobrante_sin_pago).
    const pagoId = await app((db) => nuevoPago(db, 'efectivo', '5.00'));
    expect(
      await resultado(() =>
        app((db) => saldoMov(db, { tipo: 'sobrante', monto: '5.00', adminId: null, pagoId })),
      ),
    ).toBe('ok');
    expect(
      await resultado(() =>
        app((db) => saldoMov(db, { tipo: 'cancelacion', monto: '5.00', pedidoId: null })),
      ),
    ).toBe('saldo_favor_pedido_requerido_v2');
    expect(
      await resultado(() =>
        app((db) => saldoMov(db, { tipo: 'cancelacion', monto: '-5.00', pedidoId: ped })),
      ),
    ).toBe('saldo_favor_signo_v2');
  });
});

describe('garantías diferidas: el dinero no se pierde (se rechaza al confirmar)', () => {
  it('devolucion_sin_saldo, saldo_favor_uso_faltante y pago_saldo_sin_aplicacion', async () => {
    const p = await nuevaPieza('AF12');
    const ped = await nuevoPedido();
    const item = await vender(p, ped);
    expect(await resultado(() => enTx((tx) => insertarDevolucion(tx, item, '10.00')))).toBe(
      'devolucion_sin_saldo',
    );
    const abierto = await nuevoPedido({ estado: 'abierto' });
    expect(
      await resultado(() =>
        enTx(async (tx) => aplicar(tx, await nuevoPago(tx, 'saldo_favor', '5.00'), abierto, '5.00')),
      ),
    ).toBe('saldo_favor_uso_faltante');
    expect(await resultado(() => enTx((tx) => nuevoPago(tx, 'saldo_favor', '5.00')))).toBe(
      'pago_saldo_sin_aplicacion',
    );
    // Pago saldo_favor aplicado solo en parte: lo aplicado vigente debe ser exactamente su monto.
    await app((db) => saldoMov(db, { tipo: 'cancelacion', monto: '20.00', pedidoId: ped }));
    expect(
      await resultado(() =>
        enTx(async (tx) => {
          const ap = await aplicar(tx, await nuevoPago(tx, 'saldo_favor', '10.00'), abierto, '5.00');
          await saldoMov(tx, { tipo: 'uso', monto: '-5.00', pedidoId: abierto, aplicacionPagoId: ap });
        }),
      ),
    ).toBe('pago_saldo_sin_aplicacion');
    expect(
      await resultado(() =>
        enTx(async (tx) => {
          const ap = await aplicar(tx, await nuevoPago(tx, 'saldo_favor', '10.00'), abierto, '10.00');
          await saldoMov(tx, { tipo: 'uso', monto: '-10.00', pedidoId: abierto, aplicacionPagoId: ap });
        }),
      ),
    ).toBe('ok');
    // Un pago normal no necesita nada más.
    expect(
      await resultado(() =>
        enTx(async (tx) => aplicar(tx, await nuevoPago(tx, 'efectivo', '5.00'), abierto, '5.00')),
      ),
    ).toBe('ok');
    expect(await resultado(() => enTx((tx) => nuevoPago(tx, 'efectivo', '5.00')))).toBe('ok');
  });

  it('kz_exigir_movimiento_saldo no la invoca nadie directamente', async () => {
    const r = await owner((db) =>
      db.execute<{ definer: boolean; app: boolean; publico: boolean }>(sql`
        SELECT p.prosecdef AS definer,
               has_function_privilege('kazero_app', p.oid, 'EXECUTE') AS app,
               EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'kz_exigir_movimiento_saldo'`),
    );
    expect(r.rows).toEqual([{ definer: false, app: false, publico: false }]);
  });
});
