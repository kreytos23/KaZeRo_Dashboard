import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aplicarPlan, EMAIL_ADMIN_MIGRACION, ErrorVerificacion } from '../../scripts/migrar-excel/aplicar';
import { leerLibros } from '../../scripts/migrar-excel/leer';
import { planificar } from '../../scripts/migrar-excel/planificar';
import type { PlanImportacion } from '../../scripts/migrar-excel/tipos';
import { conDbUrl } from '@/db/pool';
import { numericACentavos } from '@/domain/dinero';
import { iniciarLogin } from '@/server/auth/servicio';
import { registrarPagoDePedido } from '@/server/pagos/servicio';
import { crearPedido } from '@/server/pedidos/servicio';
import { fecha, filaConc, filaInv, librosSinteticos, type DatosSinteticos } from '../apoyo/libro-sintetico';
import { mapeoSintetico } from '../apoyo/mapeo-sintetico';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

// Libro SINTÉTICO (datos inventados): exhibidores con piezas, Notas KZR (una mixta, una con RESTA), ventas sin
// nota, regalo con cliente, rifa, "no se cobró", venta sin cliente, tarjeta con hueco y cumpleaños.
const venta = (id: string, extra: Partial<Parameters<typeof filaConc>[0]> = {}) =>
  filaConc({
    f: fecha(2026, 9, 1),
    costo: 40,
    venta: 100,
    cliente: 'Clienta Uno',
    estatus: 'Vendido',
    id,
    desc: `Anillo ${id}`,
    coment: '05sep. vende',
    ...extra,
  });

const base: DatosSinteticos = {
  inventario: [
    filaInv({ id: 'ZZ01', prod: 'Anillo uno', ubic: 'Exhibidor A - 16sep' }),
    filaInv({ id: 'ZZ02', prod: 'Anillo dos', cliente: 'Clienta Tres', vend: 'Vend A' }),
    filaInv({ id: 'ZZ03', prod: 'Anillo tres' }),
    filaInv({ id: 'ZZ04', prod: 'Collar cuatro', cat: 'Collares', ubic: 'Vitrina B - 05sep' }),
    filaInv({ id: 'ZZ05', prod: 'Anillo cinco' }),
  ],
  concentrado: [
    venta('ZZ01', { desc: 'Anillo uno', tarjeta: '1 5/9/26', cliente: 'Vend A - Clienta Uno' }),
    venta('AB02', { tarjeta: '3 20/9/26', coment: '20sep. vende' }),
    venta('AB03', {
      nota: 'KZR-5',
      cliente: 'Clienta Dos',
      estatus: 'Por cobrar',
      venta: 500,
      coment: '02sep. aparta / RESTA 120',
    }),
    venta('AB07', { nota: 'KZR-7', cliente: 'Clienta Cuatro', venta: 200, coment: '10sep. vende' }),
    venta('AB08', {
      nota: 'KZR-7',
      cliente: 'Clienta Cuatro',
      estatus: 'Por cobrar',
      venta: 300,
      coment: '10sep. aparta',
    }),
    venta('AB04', { estatus: 'No se cobró', cliente: 'Clienta Dos' }),
    venta('AB05', { estatus: 'Rifa', cliente: null }),
    venta('AB06', { cliente: null }),
    venta('AB09', { estatus: 'Regalo', cliente: 'Clienta Cuatro', coment: '12sep. regalo' }),
    venta('AB10', { f: fecha(2026, 8, 3), coment: '04ago. vende', cliente: 'Clienta Cinco' }),
  ],
  lealtad: [['Clienta Uno', fecha(2026, 9, 5), null, fecha(2026, 9, 20)]],
  cumpleB: [['Clienta Cinco', fecha(2024, 3, 3)]],
};

async function planDe(d: DatosSinteticos): Promise<PlanImportacion> {
  const b = await librosSinteticos(d);
  return planificar(await leerLibros({ ...b, hojasExhibidor: [] }), mapeoSintetico()).plan;
}

const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);
async function contar(): Promise<Record<string, number>> {
  const r = await owner((db) =>
    db.execute(sql`SELECT
      (SELECT count(*) FROM pieza)::int AS piezas, (SELECT count(*) FROM pedido)::int AS pedidos,
      (SELECT count(*) FROM pedido_item)::int AS items, (SELECT count(*) FROM pago)::int AS pagos,
      (SELECT count(*) FROM aplicacion_pago)::int AS aplicaciones,
      (SELECT count(*) FROM movimiento_pieza)::int AS movimientos, (SELECT count(*) FROM cliente)::int AS clientes,
      (SELECT count(*) FROM origen_excel)::int AS origen,
      (SELECT count(*) FROM admin WHERE email = ${EMAIL_ADMIN_MIGRACION})::int AS admin_migracion`),
  );
  return r.rows[0] as Record<string, number>;
}

describe('migrar-excel (aplicarPlan)', () => {
  let plan: PlanImportacion;
  beforeAll(async () => {
    plan = await planDe(base);
  });
  beforeEach(() => reiniciarConAdmin());

  it('aplica: inserta lo esperado y lo que queda en la BD cuadra con la conciliación del plan', async () => {
    const r = await aplicarPlan(urlOwner(), plan, { modo: 'aplicar' });
    expect(r.verificacion).toEqual({ ok: true, diferencias: [] });
    const c = plan.conciliacion.conteos;
    expect(r.insertados).toMatchObject({
      categorias: c.categorias,
      vendedores: c.vendedores,
      clientes: c.clientes,
      exhibidores: c.exhibidores,
      piezas: c.piezas,
      pedidos: c.pedidos,
      items: c.items,
      pagos: c.pagos,
      movimientos: c.piezas,
    });
    expect(c.exhibidores).toBeGreaterThan(0);
    const n = await contar();
    expect(n).toMatchObject({
      piezas: c.piezas,
      pedidos: c.pedidos,
      items: c.items,
      pagos: c.pagos,
      aplicaciones: c.pagos,
      movimientos: c.piezas,
      admin_migracion: 1,
    });
    const saldo = await conDbUrl(urlApp(), (db) =>
      db.execute(sql`SELECT coalesce(sum(saldo),0)::text AS s FROM v_pedido`),
    );
    expect(numericACentavos(saldo.rows[0]!.s as string)).toBe(plan.conciliacion.saldoTotal);
    expect(plan.conciliacion.saldoTotal).toBeGreaterThan(0);
  });

  it('re-ejecutar es idempotente: 0 inserciones y mismas cifras', async () => {
    await aplicarPlan(urlOwner(), plan, { modo: 'aplicar' });
    const antes = await contar();
    const r2 = await aplicarPlan(urlOwner(), plan, { modo: 'aplicar' });
    expect(Object.values(r2.insertados).every((x) => x === 0)).toBe(true);
    expect(r2.yaAplicados).toBeGreaterThan(0);
    expect(r2.cambiados).toEqual([]);
    expect(r2.verificacion.ok).toBe(true);
    expect(await contar()).toEqual(antes);
  });

  it('ensayo verifica y no deja nada en la BD (ni el admin de migración)', async () => {
    const r = await aplicarPlan(urlOwner(), plan, { modo: 'ensayo' });
    expect(r.modo).toBe('ensayo');
    expect(r.verificacion.ok).toBe(true);
    expect(r.insertados.piezas).toBe(plan.piezas.length);
    expect(await contar()).toMatchObject({ piezas: 0, pedidos: 0, origen: 0, admin_migracion: 0 });
  });

  it('una fila nueva en el Excel se agrega sola; una fila cambiada se reporta y no se aplica', async () => {
    await aplicarPlan(urlOwner(), plan, { modo: 'aplicar' });
    const otro = await planDe({
      ...base,
      inventario: base.inventario!.map((f) =>
        f[0] === 'ZZ05' ? filaInv({ id: 'ZZ05', prod: 'Anillo cinco', precio: 175 }) : f,
      ),
      concentrado: [
        ...base.concentrado!,
        venta('AB11', { f: fecha(2026, 9, 25), coment: '26sep. vende', cliente: 'Clienta Seis' }),
      ],
    });
    const r = await aplicarPlan(urlOwner(), otro, { modo: 'aplicar' });
    expect(r.verificacion).toEqual({ ok: true, diferencias: [] });
    expect(r.insertados).toMatchObject({ piezas: 1, pedidos: 1, items: 1, pagos: 1, clientes: 1 });
    expect(r.cambiados).toEqual([{ clave: 'inv:ZZ05', hoja: 'INVENTARIO' }]);
    const p = await owner((db) =>
      db.execute(sql`SELECT precio::text AS precio FROM pieza WHERE codigo = 'ZZ05'`),
    );
    expect(p.rows[0]!.precio).toBe('150.00'); // no se pisa
  });

  it('la siguiente Nota KZR de la app sigue a la última del Excel', async () => {
    const r = await aplicarPlan(urlOwner(), plan, { modo: 'aplicar' });
    expect(r.siguienteFolio).toBe(8);
    const [adminApp] = (
      await owner((db) => db.execute(sql`SELECT id FROM admin WHERE email <> ${EMAIL_ADMIN_MIGRACION}`))
    ).rows as { id: string }[];
    const ids = (
      await owner((db) =>
        db.execute(sql`SELECT (SELECT id FROM cliente WHERE nombre = 'Clienta Cinco') AS c,
          (SELECT id FROM vendedor WHERE nombre = 'Casa Prueba') AS v`),
      )
    ).rows[0] as { c: string; v: string };
    const nuevo = await conDbUrl(urlApp(), (db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId: adminApp!.id,
        clienteId: ids.c,
        vendedorId: ids.v,
        codigos: ['ZZ03'],
        cuentaTarjeta: false,
        descuentoManualCentavos: 0,
      }),
    );
    expect(nuevo.folio).toBe(8);
  });

  it('un pedido migrado abierto se paga y se liquida en la app', async () => {
    await aplicarPlan(urlOwner(), plan, { modo: 'aplicar' });
    const [adminApp] = (
      await owner((db) => db.execute(sql`SELECT id FROM admin WHERE email <> ${EMAIL_ADMIN_MIGRACION}`))
    ).rows as { id: string }[];
    const kzr5 = (
      await owner((db) => db.execute(sql`SELECT id, saldo::text AS saldo FROM v_pedido WHERE folio = 5`))
    ).rows[0] as { id: string; saldo: string };
    const r = await conDbUrl(urlApp(), (db) =>
      registrarPagoDePedido(db, {
        key: randomUUID(),
        adminId: adminApp!.id,
        pedidoId: kzr5.id,
        montoCentavos: numericACentavos(kzr5.saldo),
        metodo: 'efectivo',
        pagador: 'cliente',
      }),
    );
    expect(r.estado).toBe('liquidado');
    const m = await owner((db) =>
      db.execute(sql`SELECT m.tipo, m.de_estado, m.a_estado FROM movimiento_pieza m JOIN pieza p ON p.id = m.pieza_id
        WHERE p.codigo = 'H-AB03' ORDER BY m.orden`),
    );
    expect(m.rows).toEqual([
      { tipo: 'alta', de_estado: null, a_estado: 'apartada' },
      { tipo: 'venta', de_estado: 'apartada', a_estado: 'vendida' },
    ]);
  });

  it('respeta datos de la app: código existente → rechazo; folio KZR ocupado → rango histórico; catálogo y cliente reutilizados', async () => {
    const adminApp = (await owner((db) => db.execute(sql`SELECT id FROM admin LIMIT 1`))).rows[0] as {
      id: string;
    };
    await owner((db) =>
      db.execute(sql`
        WITH cat AS (INSERT INTO categoria (nombre) VALUES ('ANILLOS') RETURNING id),
             ven AS (INSERT INTO vendedor (nombre, tipo) VALUES ('Casa de la app', 'casa') RETURNING id),
             cli AS (INSERT INTO cliente (nombre) VALUES ('clienta  dos') RETURNING id),
             pz AS (INSERT INTO pieza (codigo, categoria_id, descripcion, precio, fecha_alta)
                    SELECT 'ZZ02', cat.id, 'Pieza de la app', 99, '2026-01-01' FROM cat RETURNING id)
        INSERT INTO pedido (folio, cliente_id, vendedor_id, fecha, total, admin_id, cuenta_tarjeta)
          SELECT 5, cli.id, ven.id, '2026-01-02', 0, ${adminApp.id}, false FROM cli, ven, pz`),
    );
    const antes = (
      await owner((db) =>
        db.execute(sql`SELECT p.*, p.updated_at::text AS u FROM pieza p WHERE codigo = 'ZZ02'`),
      )
    ).rows[0];
    const r = await aplicarPlan(urlOwner(), plan, { modo: 'aplicar' });
    expect(r.verificacion).toEqual({ ok: true, diferencias: [] });
    expect(r.rechazosEnBd.map((x) => x.motivo)).toEqual(
      expect.arrayContaining([
        'Código de pieza ya existe en la app',
        'Folio KZR ocupado en la app: se movió al rango histórico',
      ]),
    );
    expect(r.reutilizados).toMatchObject({ categorias: 1, clientes: 1 });
    const despues = (
      await owner((db) =>
        db.execute(sql`SELECT p.*, p.updated_at::text AS u FROM pieza p WHERE codigo = 'ZZ02'`),
      )
    ).rows[0];
    expect(despues).toEqual(antes);
    const movido = (
      await owner((db) =>
        db.execute(sql`SELECT folio, notas, (SELECT count(*) FROM cliente WHERE kz_normalizar(nombre) = 'clienta dos')::int AS n
          FROM pedido WHERE notas LIKE 'Nota original KZR-5 (Excel)%'`),
      )
    ).rows[0] as { folio: number; notas: string; n: number };
    expect(movido.folio).toBeGreaterThan(100000);
    expect(movido.n).toBe(1);
    // El pedido de la pieza rechazada (pedido abierto de inventario de ZZ02) no se importa.
    const zz02 = await owner((db) =>
      db.execute(sql`SELECT count(*)::int AS n FROM pieza WHERE codigo = 'ZZ02'`),
    );
    expect(zz02.rows[0]!.n).toBe(1);
  });

  it('si la verificación no cuadra, no queda nada (ROLLBACK)', async () => {
    const malo = structuredClone(plan);
    malo.conciliacion.saldoTotal += 1;
    malo.conciliacion.conteos.piezas += 1;
    const e = await aplicarPlan(urlOwner(), malo, { modo: 'aplicar' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorVerificacion);
    expect((e as ErrorVerificacion).diferencias.length).toBeGreaterThanOrEqual(2);
    expect(await contar()).toMatchObject({ piezas: 0, pedidos: 0, origen: 0, admin_migracion: 0 });
  });

  it('todo lo migrado queda a nombre del admin "migración" y no se escribe bitácora de ediciones', async () => {
    await aplicarPlan(urlOwner(), plan, { modo: 'aplicar' });
    const r = await owner((db) =>
      db.execute(sql`SELECT
        (SELECT count(*) FROM pedido WHERE admin_id IS DISTINCT FROM a.id)::int AS pedidos_ajenos,
        (SELECT count(*) FROM pago WHERE admin_id IS DISTINCT FROM a.id)::int AS pagos_ajenos,
        (SELECT count(*) FROM movimiento_pieza WHERE admin_id IS DISTINCT FROM a.id)::int AS movs_ajenos,
        (SELECT count(*) FROM movimiento_pieza WHERE nota IS NULL)::int AS movs_sin_nota,
        (SELECT count(*) FROM auditoria WHERE admin_id IS DISTINCT FROM a.id)::int AS bitacora_ajena
        FROM admin a WHERE a.email = ${EMAIL_ADMIN_MIGRACION}`),
    );
    expect(r.rows[0]).toEqual({
      pedidos_ajenos: 0,
      pagos_ajenos: 0,
      movs_ajenos: 0,
      movs_sin_nota: 0,
      bitacora_ajena: 0,
    });
  });

  it('el admin de migración no puede iniciar sesión', async () => {
    await aplicarPlan(urlOwner(), plan, { modo: 'aplicar' });
    const red = { ip: null, userAgent: null };
    for (const password of ['', 'migracion', randomBytes(32).toString('base64url')]) {
      const r = await conDbUrl(urlApp(), (db) =>
        iniciarLogin(db, { email: EMAIL_ADMIN_MIGRACION, password, ...red }),
      );
      expect(r).toEqual({ ok: false, motivo: 'credenciales' });
    }
    const a = await owner((db) =>
      db.execute(sql`SELECT password_hash LIKE '$argon2id$%' AS argon, totp_secret_cifrado AS t FROM admin
        WHERE email = ${EMAIL_ADMIN_MIGRACION}`),
    );
    expect(a.rows[0]).toEqual({ argon: true, t: 'migracion:sin-totp' });
  });
});
