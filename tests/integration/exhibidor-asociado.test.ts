import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { exhibidor, pedido } from '@/db/schema';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { crearCliente } from '@/server/clientes/servicio';
import { ErrorNegocio, traducirErrorPg } from '@/server/errores';
import {
  registrarAjusteExhibidor,
  registrarEntregaExhibidor,
  registrarVentaExhibidor,
} from '@/server/exhibidores/dinero';
import {
  cerrarExhibidor,
  crearExhibidor,
  editarExhibidor,
  enviarPiezas,
  listarExhibidores,
  obtenerExhibidor,
  regresarPiezas,
} from '@/server/exhibidores/servicio';
import { cancelarPedido, crearPedido } from '@/server/pedidos/servicio';
import { altaPieza, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { actualizarVendedor, crearVendedor, obtenerVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

// Corregir el asociado de un exhibidor (2026-11-25). Datos SINTÉTICOS.
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);
const CON_VENTAS = 'Este exhibidor ya tiene ventas o dinero: su asociado no se puede cambiar.';
let adminId = '';
let perlaId = '';
let rosaId = '';
let clienteId = '';
let exhibidorId = '';

const vista = async () => (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
const cambiar = async (o: Partial<Parameters<typeof editarExhibidor>[1]> = {}) => {
  const e = await vista();
  return app((db) =>
    editarExhibidor(db, {
      exhibidorId,
      version: e.version,
      adminId,
      motivo: 'Se asignó por error',
      nombre: e.nombre,
      fechaEnvio: e.fechaEnvio,
      vendedorId: rosaId,
      ...o,
    }),
  );
};
const codigoDe = (e: unknown) =>
  (e instanceof ErrorNegocio ? e.codigo : traducirErrorPg(e)?.codigo) ?? String(e);
const falla = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => codigoDe(e),
  );
const contexto = (motivo: string | null) =>
  sql`SELECT set_config('kazero.admin_id', ${adminId}, true), set_config('kazero.motivo', ${motivo ?? ''}, true)`;
/** UPDATE directo, con el contexto de auditoría que fijaría un servicio. */
const directo = (motivo: string | null = 'x', url = urlApp()) =>
  conDbUrl(url, (db) =>
    db.transaction(async (tx) => {
      await tx.execute(contexto(motivo));
      await tx.execute(sql`UPDATE exhibidor SET vendedor_id = ${rosaId} WHERE id = ${exhibidorId}`);
    }),
  );
const venta = (cobradoCentavos: number) =>
  app((db) =>
    registrarVentaExhibidor(db, {
      key: randomUUID(),
      adminId,
      exhibidorId,
      codigos: ['AS01'],
      clienteId: null,
      cobradoCentavos,
      metodo: 'efectivo',
    }),
  );
const ajuste = (montoCentavos: number) =>
  app((db) =>
    registrarAjusteExhibidor(db, { key: randomUUID(), adminId, exhibidorId, montoCentavos, motivo: 'Caja' }),
  );
/** Un pago cobrado por el exhibidor y nada más (sin nota ni piezas): aísla esa condición. */
const pagoSuelto = (anulado: boolean) =>
  owner((db) =>
    db.execute(sql`
      INSERT INTO pago (idempotency_key, fecha, monto, metodo, pagador_cliente_id, admin_id, exhibidor_id,
                        anulado_at, anulacion_motivo, anulado_por)
      VALUES (${randomUUID()}, '2026-10-02', 50, 'efectivo', ${clienteId}, ${adminId}, ${exhibidorId},
              ${anulado ? sql`now()` : sql`NULL`}, ${anulado ? sql`'Error'` : sql`NULL`},
              ${anulado ? sql`${adminId}::uuid` : sql`NULL`})`),
  );
async function seRechaza() {
  expect((await vista()).conVentasODinero).toBe(true);
  await expect(cambiar()).rejects.toMatchObject({
    codigo: 'exhibidor_asociado_con_ventas',
    campo: 'vendedorId',
    message: CON_VENTAS,
  });
  expect(await falla(directo())).toBe('exhibidor_asociado_con_ventas');
  expect(await falla(directo('x', urlOwner()))).toBe('exhibidor_asociado_con_ventas');
  expect((await vista()).vendedorId).toBe(perlaId);
}

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  perlaId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla Ejemplo', tipo: 'revendedora', comisionPct: '18.00' }),
  );
  rosaId = await app((db) =>
    crearVendedor(db, { nombre: 'Rosa Ejemplo', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  clienteId = await app((db) => crearCliente(db, { nombre: 'Clienta Sintética' }));
  exhibidorId = await app((db) =>
    crearExhibidor(db, { vendedorId: perlaId, nombre: 'Vitrina Ejemplo', fechaEnvio: '2026-10-01' }),
  );
  for (const codigo of ['AS01', 'AS02'])
    await app((db) =>
      altaPieza(db, {
        codigo,
        categoria: 'Aretes',
        descripcion: `Arete ${codigo}`,
        costoCentavos: 0,
        precioCentavos: 10000,
      }),
    );
  await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['AS01', 'AS02'] }));
});

describe('cambiar el asociado', () => {
  it('cambia, deja historial con los nombres y el motivo, y las piezas se quedan', async () => {
    const antes = await vista();
    expect(antes.conVentasODinero).toBe(false);
    expect(await cambiar()).toEqual({ cambios: 1 });
    expect(await vista()).toMatchObject({
      vendedorId: rosaId,
      vendedorNombre: 'Rosa Ejemplo',
      version: antes.version + 1,
      piezasActuales: 2,
    });
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'AS01')))!).toMatchObject({
      estado: 'en_exhibidor',
      exhibidorId,
    });
    const [h] = await app((db) => historialDeCambios(db, 'exhibidor', exhibidorId));
    expect(h).toMatchObject({
      motivo: 'Se asignó por error',
      campos: [{ campo: 'vendedor', antes: 'Perla Ejemplo', despues: 'Rosa Ejemplo' }],
    });
    expect(await app((db) => listarExhibidores(db, { vendedorId: perlaId }))).toHaveLength(0);
    expect(await app((db) => listarExhibidores(db, { vendedorId: rosaId }))).toHaveLength(1);
  });

  it('el UPDATE directo válido pasa como kazero_app (ya puede actualizar la columna)', async () => {
    expect(await falla(directo())).toBeNull();
    expect((await vista()).vendedorId).toBe(rosaId);
  });

  it('enviar y regresar piezas no bloquea, y la venta posterior es del asociado nuevo', async () => {
    await app((db) => regresarPiezas(db, { exhibidorId, codigos: ['AS02'] }));
    await cambiar();
    const v = await venta(10000);
    const [p] = await app((db) => db.select().from(pedido).where(eq(pedido.id, v.pedidoId)));
    expect(p!.vendedorId).toBe(rosaId);
  });

  it('el mismo asociado, o ninguno, no es un cambio (ni pide motivo)', async () => {
    expect(await cambiar({ vendedorId: perlaId, motivo: '' })).toEqual({ cambios: 0 });
    expect(await cambiar({ vendedorId: undefined, motivo: '' })).toEqual({ cambios: 0 });
    expect(await cambiar({ vendedorId: undefined, motivo: '', nombre: 'Otro nombre' })).toEqual({
      cambios: 1,
    });
  });

  it('con ventas, el nombre y la fecha se siguen editando', async () => {
    await venta(0);
    expect(await cambiar({ vendedorId: perlaId, nombre: 'Otro nombre' })).toEqual({ cambios: 1 });
  });

  it('exige motivo: en el servicio y en la BD', async () => {
    await expect(cambiar({ motivo: '  ' })).rejects.toMatchObject({
      campo: 'motivo',
      message: 'Escribe el motivo: cambiaste el asociado.',
    });
    expect(await falla(directo(null))).toBe('exhibidor_asociado_sin_motivo');
  });

  it('rechaza un asociado inactivo o inexistente', async () => {
    const r = (await app((db) => obtenerVendedor(db, rosaId)))!;
    await app((db) => actualizarVendedor(db, { ...r, adminId, activo: false }));
    await expect(cambiar()).rejects.toMatchObject({ codigo: 'vendedor_inactivo', campo: 'vendedorId' });
    await expect(cambiar({ vendedorId: randomUUID() })).rejects.toMatchObject({
      codigo: 'no_encontrado',
      campo: 'vendedorId',
    });
  });

  it('rechaza una versión vieja y un exhibidor cerrado (también por UPDATE directo)', async () => {
    const { version } = await vista();
    await cambiar({ vendedorId: undefined, nombre: 'Otro nombre' });
    await expect(cambiar({ version })).rejects.toMatchObject({ codigo: 'conflicto' });
    await app((db) => regresarPiezas(db, { exhibidorId, codigos: ['AS01', 'AS02'] }));
    const abierto = await vista();
    await app((db) => cerrarExhibidor(db, { exhibidorId, version: abierto.version }));
    await expect(cambiar()).rejects.toMatchObject({ codigo: 'exhibidor_cerrado' });
    expect(await falla(directo())).toBe('exhibidor_asociado_cerrado');
  });
});

describe('con ventas o dinero no cambia (servicio y trigger)', () => {
  it('un pago vigente', async () => {
    await pagoSuelto(false);
    await seRechaza();
  });
  it('un pago anulado', async () => {
    await pagoSuelto(true);
    await seRechaza();
  });
  it('un ajuste', async () => {
    await ajuste(5000);
    await seRechaza();
  });
  it('una entrega (aunque el por entregar quede en cero)', async () => {
    await ajuste(5000);
    await app((db) =>
      registrarEntregaExhibidor(db, {
        key: randomUUID(),
        adminId,
        exhibidorId,
        montoCentavos: 5000,
        metodo: 'efectivo',
      }),
    );
    await seRechaza();
  });
  it('una pieza apartada ligada (sin más)', async () => {
    await owner((db) => db.execute(sql`UPDATE pieza SET estado = 'apartada' WHERE codigo = 'AS01'`));
    await seRechaza();
  });
  it('una venta sin cobro', async () => {
    await venta(0);
    await seRechaza();
  });
  it('una nota normal ya cancelada (la pieza volvió al exhibidor)', async () => {
    const p = await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        clienteId,
        vendedorId: perlaId,
        codigos: ['AS01'],
        cuentaTarjeta: false,
        descuentoManualCentavos: 0,
      }),
    );
    await app((db) =>
      cancelarPedido(db, { key: randomUUID(), adminId, pedidoId: p.id, version: 1, motivo: 'Prueba' }),
    );
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'AS01')))!.estado).toBe('en_exhibidor');
    await seRechaza();
  });
  it('una pieza migrada del Excel ya apartada, aunque después se vendiera', async () => {
    await owner((db) =>
      db.transaction(async (tx) => {
        const r = await tx.execute<{ id: string }>(sql`
          INSERT INTO pieza (codigo, categoria_id, descripcion, precio, fecha_alta, estado, exhibidor_id)
          SELECT 'AS09', id, 'Arete AS09', 100, DATE '2026-10-01', 'apartada'::estado_pieza, ${exhibidorId}::uuid
            FROM categoria LIMIT 1
          RETURNING id`);
        const id = r.rows[0]!.id;
        await tx.execute(sql`INSERT INTO movimiento_pieza (pieza_id, tipo, a_estado, exhibidor_id)
          VALUES (${id}, 'alta', 'apartada', ${exhibidorId})`);
        await tx.execute(sql`UPDATE pieza SET estado = 'vendida', exhibidor_id = NULL WHERE id = ${id}`);
      }),
    );
    await seRechaza();
  });
});

describe('carreras', () => {
  it('el trigger espera a una escritura sin confirmar que solo tiene la FK del exhibidor, y la ve', async () => {
    const e = await vista();
    let cambio: Promise<string | null> = Promise.resolve(null);
    const durante = await owner((db) =>
      db.transaction(async (tx) => {
        // INSERT directo: no bloquea el exhibidor, solo toma FOR KEY SHARE por su llave foránea.
        await tx.execute(sql`
          INSERT INTO entrega_exhibidor (exhibidor_id, tipo, monto, fecha, nota, admin_id)
          VALUES (${exhibidorId}, 'ajuste', 50, '2026-10-02', 'Caja', ${adminId})`);
        cambio = falla(cambiar({ version: e.version }));
        return Promise.race([
          cambio.then((r) => `terminó: ${r}`),
          new Promise<string>((r) => setTimeout(() => r('esperando'), 3000)),
        ]);
      }),
    );
    expect(await cambio).toBe('exhibidor_asociado_con_ventas');
    expect(durante).toBe('esperando');
    expect((await vista()).vendedorId).toBe(perlaId);
  });

  it('una escritura directa espera al cambio de asociado en curso', async () => {
    let insercion: Promise<string | null> = Promise.resolve(null);
    const durante = await app((db) =>
      db.transaction(async (tx) => {
        await tx.execute(contexto('x'));
        await tx.update(exhibidor).set({ vendedorId: rosaId }).where(eq(exhibidor.id, exhibidorId));
        insercion = falla(pagoSuelto(false));
        return Promise.race([
          insercion.then((r) => `terminó: ${r}`),
          new Promise<string>((r) => setTimeout(() => r('esperando'), 3000)),
        ]);
      }),
    );
    expect(await insercion).toBeNull();
    expect(durante).toBe('esperando');
    expect((await vista()).vendedorId).toBe(rosaId);
  });

  it('venta y cambio simultáneos: la nota es siempre del asociado con que quedó el exhibidor', async () => {
    const [cambio, v] = await Promise.allSettled([cambiar(), venta(10000)]);
    expect(v.status).toBe('fulfilled');
    if (cambio.status === 'rejected') expect(codigoDe(cambio.reason)).toBe('exhibidor_asociado_con_ventas');
    const [p] = await app((db) => db.select().from(pedido));
    const e = await vista();
    expect(p!.vendedorId).toBe(e.vendedorId);
    expect(e.vendedorId).toBe(cambio.status === 'fulfilled' ? rosaId : perlaId);
  });
});
