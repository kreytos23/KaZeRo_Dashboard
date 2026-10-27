import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aplicarKzr, ErrorPlanCambio, ErrorPlanConErrores, simular } from '../../scripts/importar-kzr/bd';
import type { FilaExcel } from '../../scripts/importar-kzr/tipos';
import { EMAIL_ADMIN_MIGRACION } from '../../scripts/migrar-excel/aplicar';
import { conDbUrl } from '@/db/pool';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { crearCliente } from '@/server/clientes/servicio';
import { crearPedido } from '@/server/pedidos/servicio';
import { entregarAVendedora } from '@/server/piezas/custodia';
import { altaPieza } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, truncarTodo, urlApp, urlOwner } from './utilidades';

// Datos SINTÉTICOS: ningún nombre ni valor real.
const HOY = '2026-10-26';
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);
let adminId = '';
let ids: { vendA: string; vendB: string; ana: string; beto: string };

async function pieza(codigo: string, precioCentavos = 10000) {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Anillos',
      descripcion: `Anillo ${codigo}`,
      costoCentavos: 0,
      precioCentavos,
    }),
  );
}
const fila = (n: number, extra: Partial<FilaExcel> = {}): FilaExcel => ({
  fila: n,
  nota: 'KZR-08',
  id: 'ZZ01',
  descripcion: 'Anillo ZZ01',
  tarjeta: '1 16/09/2026',
  cliente: 'ana  SÁNCHEZ',
  vendedor: 'Vend A - Ana Sánchez',
  estatus: 'Por cobrar',
  ...extra,
});
async function contar() {
  const r = await owner((db) =>
    db.execute(
      sql`SELECT (SELECT count(*) FROM pedido)::int AS pedidos, (SELECT count(*) FROM pedido_item)::int AS items,
        (SELECT count(*) FROM movimiento_pieza WHERE tipo = 'apartado')::int AS movs, (SELECT count(*) FROM origen_excel)::int AS origen,
        (SELECT count(*) FROM pieza WHERE estado = 'apartada')::int AS apartadas,
        (SELECT count(*) FROM admin WHERE lower(email) = ${EMAIL_ADMIN_MIGRACION})::int AS admin_mig`,
    ),
  );
  return r.rows[0] as Record<string, number>;
}
const secuencia = async () =>
  (await owner((db) => db.execute(sql`SELECT last_value::int AS v, is_called AS c FROM pedido_folio_seq`)))
    .rows[0] as { v: number; c: boolean };
const aplicar = (filas: FilaExcel[], hashEsperado?: string) =>
  aplicarKzr(urlOwner(), filas, { modo: 'aplicar', hoy: HOY, ...(hashEsperado ? { hashEsperado } : {}) });
async function erroresDe(filas: FilaExcel[]) {
  const antes = await contar();
  const e = await aplicar(filas).then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErrorPlanConErrores);
  expect(await contar()).toEqual(antes); // nada se escribió
  return (e as ErrorPlanConErrores).plan.errores.map((x) => x.codigo);
}

beforeAll(async () => {
  await truncarTodo();
});
beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  const vendA = await app((db) =>
    crearVendedor(db, { nombre: 'Vend A', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  const vendB = await app((db) =>
    crearVendedor(db, { nombre: 'Vend B', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  const ana = await app((db) => crearCliente(db, { nombre: 'Ana Sánchez' }));
  const beto = await app((db) => crearCliente(db, { nombre: 'Beto Díaz' }));
  ids = { vendA, vendB, ana, beto };
  for (const c of ['ZZ01', 'ZZ02', 'ZZ03', 'ZZ04']) await pieza(c);
});

describe('importar notas KZR', () => {
  it('camino feliz: pedidos con folio, fecha, lugar y descuento; piezas apartadas; origen; setval', async () => {
    const filas = [
      fila(2, { nota: 'KZR-08', id: 'zz01' }),
      fila(3, { nota: 'KZR-08', id: 'ZZ02' }),
      fila(4, { nota: 'KZR-12', id: 'ZZ03', cliente: 'Beto Díaz', tarjeta: '5 20/09/2026' }),
    ];
    // simular: solo lectura (ni siquiera crea el admin de migración).
    const plan = await simular(urlOwner(), filas, HOY);
    expect(plan.errores).toEqual([]);
    expect(plan.siguienteFolio).toBe(13);
    expect(await contar()).toMatchObject({ pedidos: 0, origen: 0, apartadas: 0, admin_mig: 0 });

    // ensayo: aplica y deshace; la secuencia no se toca.
    const seq0 = await secuencia();
    const ens = await aplicarKzr(urlOwner(), filas, { modo: 'ensayo', hoy: HOY, hashEsperado: plan.hash });
    expect(ens.insertados).toMatchObject({
      pedidos: 2,
      items: 3,
      piezasApartadas: 3,
      movimientos: 3,
      origen: 2,
    });
    expect(ens.verificacion.ok).toBe(true);
    expect(await contar()).toMatchObject({ pedidos: 0, origen: 0, apartadas: 0, admin_mig: 0 });
    expect(await secuencia()).toEqual(seq0);

    // aplicar
    const r = await aplicar(filas, plan.hash);
    expect(r.insertados).toMatchObject({
      pedidos: 2,
      items: 3,
      piezasApartadas: 3,
      movimientos: 3,
      origen: 2,
    });
    expect(r.siguienteFolio).toBe(13);
    expect(await contar()).toMatchObject({
      pedidos: 2,
      items: 3,
      apartadas: 3,
      movs: 3,
      origen: 2,
      admin_mig: 1,
    });
    const peds = (
      await owner((db) =>
        db.execute(sql`SELECT folio, fecha::text AS fecha, cliente_id, vendedor_id, estado, ciclo_tarjeta, posicion_tarjeta,
          descuento_lealtad_pct::text AS pct, total::text AS total FROM pedido ORDER BY folio`),
      )
    ).rows;
    expect(peds).toEqual([
      expect.objectContaining({
        folio: 8,
        fecha: '2026-09-16',
        cliente_id: ids.ana,
        vendedor_id: ids.vendA,
        estado: 'abierto',
        ciclo_tarjeta: 1,
        posicion_tarjeta: 1,
        pct: '0.00',
        total: '200.00',
      }),
      expect.objectContaining({
        folio: 12,
        fecha: '2026-09-20',
        cliente_id: ids.beto,
        posicion_tarjeta: 5,
        pct: '10.00',
        total: '90.00',
      }),
    ]);
    // Movimientos firmados por el admin de migración; ninguna venta ni pago.
    const mov = (
      await owner((db) =>
        db.execute(sql`SELECT count(*)::int AS c FROM movimiento_pieza m JOIN admin a ON a.id = m.admin_id
          WHERE m.tipo = 'apartado' AND lower(a.email) = ${EMAIL_ADMIN_MIGRACION}`),
      )
    ).rows[0] as { c: number };
    expect(mov.c).toBe(3);
    expect((await owner((db) => db.execute(sql`SELECT count(*)::int AS c FROM pago`))).rows[0]).toEqual({
      c: 0,
    });

    // setval: el siguiente pedido de la app sigue después del mayor folio.
    const siguiente = await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        clienteId: ids.ana,
        vendedorId: ids.vendA,
        codigos: ['ZZ04'],
        cuentaTarjeta: true,
        descuentoManualCentavos: 0,
      }),
    );
    expect(siguiente.folio).toBe(13);
    // La tarjeta de Ana: la app asigna el siguiente lugar libre (2), después del lugar 1 importado.
    expect(siguiente.posicion).toEqual({ ciclo: 1, posicion: 2 });
  });

  it('idempotente: repetir inserta 0 filas y no cambia nada', async () => {
    const filas = [fila(2), fila(3, { id: 'ZZ02' })];
    await aplicar(filas);
    const antes = await contar();
    const seq = await secuencia();
    const r = await aplicar(filas);
    expect(r.insertados).toEqual({ pedidos: 0, items: 0, piezasApartadas: 0, movimientos: 0, origen: 0 });
    expect(r.yaAplicadas).toBe(1);
    expect(await contar()).toEqual(antes);
    expect(await secuencia()).toEqual(seq);
  });

  it('cambia el contenido de una nota ya importada → error, no se toca', async () => {
    await aplicar([fila(2)]);
    expect(await erroresDe([fila(2, { id: 'ZZ02' })])).toEqual(['origen_cambiado']);
  });

  it('el hash aprobado debe coincidir: si la BD cambió, ROLLBACK', async () => {
    const filas = [fila(2)];
    const plan = await simular(urlOwner(), filas, HOY);
    await owner((db) =>
      db.transaction(async (tx) => {
        await fijarContextoAuditoria(tx, { adminId, motivo: 'prueba: cambia el precio' });
        await tx.execute(sql`UPDATE pieza SET precio = 123.00 WHERE codigo = 'ZZ01'`);
      }),
    );
    await expect(aplicar(filas, plan.hash)).rejects.toBeInstanceOf(ErrorPlanCambio);
    expect(await contar()).toMatchObject({ pedidos: 0, origen: 0, admin_mig: 0 });
  });

  it('errores: pieza inexistente, no disponible, de otra vendedora, estatus, tarjeta, cliente, vendedora', async () => {
    expect(await erroresDe([fila(2, { id: 'NOEXISTE' })])).toEqual(['pieza_faltante']);
    expect(await erroresDe([fila(2, { estatus: 'Pagado' })])).toEqual(['estatus_no_soportado']);
    expect(await erroresDe([fila(2, { tarjeta: '1.N' })])).toEqual(['tarjeta_formato_no_soportado']);
    expect(await erroresDe([fila(2, { tarjeta: '1 27/10/2026' })])).toEqual(['tarjeta_fecha_futura']);
    expect(await erroresDe([fila(2, { cliente: 'Nadie' })])).toEqual(['cliente_no_encontrado']);
    expect(await erroresDe([fila(2, { vendedor: 'Nadie - Ana' })])).toEqual(['vendedor_no_encontrado']);
    // Otra nota ya apartó la pieza → no disponible.
    await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        clienteId: ids.beto,
        vendedorId: ids.vendA,
        codigos: ['ZZ02'],
        cuentaTarjeta: false,
        descuentoManualCentavos: 0,
      }),
    );
    expect(await erroresDe([fila(2, { id: 'ZZ02' })])).toEqual(['pieza_no_disponible']);
    // La tiene Vend B → solo se vende en su nota.
    await app((db) => entregarAVendedora(db, { adminId, vendedorId: ids.vendB, codigos: ['ZZ03'] }));
    expect(await erroresDe([fila(2, { id: 'ZZ03' })])).toEqual(['pieza_de_otra_vendedora']);
  });

  it('lugar ocupado en la tarjeta actual del cliente', async () => {
    await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        clienteId: ids.ana,
        vendedorId: ids.vendA,
        codigos: ['ZZ02'],
        cuentaTarjeta: true,
        descuentoManualCentavos: 0,
      }),
    ); // Ana: vuelta 1, lugar 1 (folio 1)
    expect(await erroresDe([fila(2, { nota: 'KZR-8' })])).toEqual(['lugar_ocupado']);
  });

  it('folio que ya existe como pedido', async () => {
    const p = await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        clienteId: ids.beto,
        vendedorId: ids.vendA,
        codigos: ['ZZ02'],
        cuentaTarjeta: false,
        descuentoManualCentavos: 0,
      }),
    );
    expect(await erroresDe([fila(2, { nota: `KZR-${p.folio}` })])).toEqual(['folio_existente']);
  });

  it('un error en una nota no deja escribir las demás (todo o nada)', async () => {
    const filas = [fila(2), fila(3, { nota: 'KZR-9', id: 'NOEXISTE', cliente: 'Beto Díaz' })];
    expect(await erroresDe(filas)).toEqual(['pieza_faltante']);
  });
});
