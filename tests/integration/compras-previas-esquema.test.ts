import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { traducirErrorPg } from '@/server/errores';
import { crearCliente } from '@/server/clientes/servicio';
import { crearPedido } from '@/server/pedidos/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

// Datos SINTÉTICOS. Las escrituras directas van por el dueño, como un script o un error de la app.
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);
let adminId = '';
let vendedorId = '';
let clienteId = '';

const falla = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => traducirErrorPg(e)?.codigo ?? String(e),
  );
/** UPDATE de compras previas con contexto de auditoría (motivo opcional), en una transacción del dueño. */
const fijarPrevias = (n: number, motivo: string | null = 'Tarjeta en papel') =>
  owner((db) =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('kazero.admin_id', ${adminId}, true), set_config('kazero.motivo', ${motivo ?? ''}, true)`,
      );
      await tx.execute(sql`UPDATE cliente SET compras_previas = ${n} WHERE id = ${clienteId}`);
    }),
  );
const pedido = async (codigo: string) => {
  await app((db) =>
    altaPieza(db, {
      codigo,
      categoria: 'Aretes',
      descripcion: `Arete ${codigo}`,
      costoCentavos: 0,
      precioCentavos: 10000,
    }),
  );
  return app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      clienteId,
      vendedorId,
      codigos: [codigo],
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
    }),
  );
};

beforeEach(async () => {
  adminId = await reiniciarConAdmin();
  vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla Ejemplo', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  clienteId = await app((db) => crearCliente(db, { nombre: 'Clienta Sintética' }));
});

describe('compras previas en la BD', () => {
  it('L-1: empieza en 0 y el CHECK limita a 0–9', async () => {
    const [c] = await owner((db) =>
      db.execute(sql`SELECT compras_previas AS n FROM cliente WHERE id = ${clienteId}`),
    ).then((r) => r.rows as { n: number }[]);
    expect(c!.n).toBe(0);
    expect(
      await falla(
        owner((db) =>
          db.execute(sql`INSERT INTO cliente (nombre, compras_previas) VALUES ('Otra Sintética', 10)`),
        ),
      ),
    ).toBe('cliente_compras_previas_rango');
  });

  it('la venta de mostrador no tiene compras previas', async () => {
    const r = await falla(
      owner((db) =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('kazero.admin_id', ${adminId}, true), set_config('kazero.motivo', 'x', true)`,
          );
          await tx.execute(sql`UPDATE cliente SET compras_previas = 2 WHERE es_mostrador`);
        }),
      ),
    );
    expect(r).toBe('cliente_mostrador_sin_previas');
  });

  it('L-5: cambiarlas exige motivo', async () => {
    expect(await falla(fijarPrevias(3, null))).toBe('cliente_previas_sin_motivo');
    expect(await fijarPrevias(3)).toBeUndefined();
  });

  it('L-5: no se cambian si ya hay una nota vigente en la primera tarjeta', async () => {
    await fijarPrevias(2);
    await pedido('CP01');
    expect(await falla(fijarPrevias(4))).toBe('cliente_previas_con_notas');
  });

  it('L-4: la BD rechaza mover una nota a un lugar previo', async () => {
    await fijarPrevias(4);
    const p = await pedido('CP02');
    const r = await falla(
      owner((db) => db.execute(sql`UPDATE pedido SET posicion_tarjeta = 3 WHERE id = ${p.id}`)),
    );
    expect(r).toBe('pedido_lugar_previo');
  });

  it('el cambio queda en la auditoría con su motivo', async () => {
    await fijarPrevias(5, 'Tarjeta en papel');
    const filas = await owner((db) =>
      db.execute(
        sql`SELECT a.motivo, c.campo, c.antes, c.despues FROM auditoria a JOIN auditoria_campo c ON c.auditoria_id = a.id WHERE a.entidad_id = ${clienteId}`,
      ),
    ).then((r) => r.rows);
    expect(filas).toEqual([
      { motivo: 'Tarjeta en papel', campo: 'compras_previas', antes: '0', despues: '5' },
    ]);
  });

  it('kazero_app puede leerlas en v_cliente', async () => {
    const r = await app((db) =>
      db.execute(sql`SELECT compras_previas FROM v_cliente WHERE id = ${clienteId}`),
    );
    expect(r.rows).toHaveLength(1);
  });
});
