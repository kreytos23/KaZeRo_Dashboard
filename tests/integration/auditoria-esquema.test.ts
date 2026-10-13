import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pgCode } from '@/db/errors';
import { categoria, exhibidor, movimientoPieza, pieza, vendedor } from '@/db/schema';
import { traducirErrorPg } from '@/server/errores';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const owner = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlOwner(), fn);

async function capturar(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** Una edición como la hace la app: contexto de auditoría y UPDATE en la misma transacción. */
function editar(contexto: { adminId: string; motivo?: string } | null, consulta: ReturnType<typeof sql>) {
  return app((db) =>
    db.transaction(async (tx) => {
      if (contexto)
        await tx.execute(
          sql`SELECT set_config('kazero.admin_id', ${contexto.adminId}, true), set_config('kazero.motivo', ${contexto.motivo ?? ''}, true)`,
        );
      await tx.execute(consulta);
    }),
  );
}

async function piezaBase(codigo = 'AU01') {
  return app(async (db) => {
    const [c] = await db.insert(categoria).values({ nombre: 'Anillos' }).returning({ id: categoria.id });
    const [p] = await db
      .insert(pieza)
      .values({
        codigo,
        categoriaId: c!.id,
        descripcion: 'Anillo',
        precio: '149.00',
        fechaAlta: '2026-10-11',
      })
      .returning({ id: pieza.id });
    await db.insert(movimientoPieza).values({ piezaId: p!.id, tipo: 'alta', aEstado: 'disponible' });
    return { piezaId: p!.id, categoriaId: c!.id };
  });
}

const bitacora = (entidadId: string) =>
  owner((db) =>
    db.execute<{
      entidad: string;
      campo: string;
      antes: string | null;
      despues: string | null;
      motivo: string | null;
      admin_id: string;
    }>(sql`
      SELECT a.entidad::text AS entidad, c.campo, c.antes, c.despues, a.motivo, a.admin_id
      FROM auditoria a JOIN auditoria_campo c ON c.auditoria_id = a.id
      WHERE a.entidad_id = ${entidadId} ORDER BY a.orden, c.posicion`),
  ).then((r) => r.rows);

let adminId: string;
beforeEach(async () => {
  adminId = await reiniciarConAdmin();
});

describe('bitácora por trigger (R-08)', () => {
  it('registra solo lo que cambió, con el nombre del catálogo, el motivo y quién lo hizo', async () => {
    const { piezaId } = await piezaBase();
    const [aretes] = await app((db) =>
      db.insert(categoria).values({ nombre: 'Aretes' }).returning({ id: categoria.id }),
    );
    await editar(
      { adminId, motivo: 'Subió el proveedor' },
      sql`UPDATE pieza SET descripcion = 'Arete', categoria_id = ${aretes!.id}, precio = '199.00', costo = costo WHERE id = ${piezaId}`,
    );
    expect(await bitacora(piezaId)).toEqual([
      {
        entidad: 'pieza',
        campo: 'descripcion',
        antes: 'Anillo',
        despues: 'Arete',
        motivo: 'Subió el proveedor',
        admin_id: adminId,
      },
      {
        entidad: 'pieza',
        campo: 'categoria',
        antes: 'Anillos',
        despues: 'Aretes',
        motivo: 'Subió el proveedor',
        admin_id: adminId,
      },
      {
        entidad: 'pieza',
        campo: 'precio',
        antes: '149.00',
        despues: '199.00',
        motivo: 'Subió el proveedor',
        admin_id: adminId,
      },
    ]);
  });

  it('una edición que no cambia nada no escribe (no-op)', async () => {
    const { piezaId } = await piezaBase();
    await editar(
      { adminId },
      sql`UPDATE pieza SET descripcion = descripcion, precio = precio WHERE id = ${piezaId}`,
    );
    expect(await bitacora(piezaId)).toEqual([]);
  });

  it('cambiar dinero sin motivo se rechaza en la BD y no cambia nada (R-09)', async () => {
    const { piezaId } = await piezaBase();
    const e = await capturar(() =>
      editar({ adminId }, sql`UPDATE pieza SET precio = '1.00' WHERE id = ${piezaId}`),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('auditoria_motivo_dinero');
    const r = await owner((db) =>
      db.execute<{ precio: string }>(sql`SELECT precio::text FROM pieza WHERE id = ${piezaId}`),
    );
    expect(r.rows[0]!.precio).toBe('149.00');
  });

  it('la comisión del vendedor también exige motivo; su nombre no', async () => {
    const [v] = await app((db) =>
      db
        .insert(vendedor)
        .values({ nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' })
        .returning({ id: vendedor.id }),
    );
    const e = await capturar(() =>
      editar({ adminId }, sql`UPDATE vendedor SET comision_pct = '20.00' WHERE id = ${v!.id}`),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('auditoria_motivo_dinero');
    await editar(
      { adminId },
      sql`UPDATE vendedor SET nombre = 'Nelly R', activo = false WHERE id = ${v!.id}`,
    );
    expect((await bitacora(v!.id)).map((f) => [f.campo, f.antes, f.despues, f.motivo])).toEqual([
      ['nombre', 'Nelly', 'Nelly R', null],
      ['activo', 'true', 'false', null],
    ]);
  });

  it('sin contexto de auditoría la edición falla (fail-closed)', async () => {
    const { piezaId } = await piezaBase();
    const e = await capturar(() =>
      editar(null, sql`UPDATE pieza SET descripcion = 'X' WHERE id = ${piezaId}`),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('auditoria_sin_admin');
  });

  it('los cambios de estado no pasan por la bitácora (van en movimiento_pieza)', async () => {
    const { piezaId } = await piezaBase();
    await editar(
      null,
      sql`UPDATE pieza SET estado = 'guardada', version = version + 1 WHERE id = ${piezaId}`,
    );
    expect(await bitacora(piezaId)).toEqual([]);
  });

  it('kazero_app no puede escribir, editar ni borrar la bitácora', async () => {
    const { piezaId } = await piezaBase();
    await editar({ adminId }, sql`UPDATE pieza SET descripcion = 'Arete' WHERE id = ${piezaId}`);
    const ins = await capturar(() =>
      app((db) =>
        db.execute(
          sql`INSERT INTO auditoria (entidad, entidad_id, admin_id) VALUES ('pieza', ${piezaId}, ${adminId})`,
        ),
      ),
    );
    const upd = await capturar(() => app((db) => db.execute(sql`UPDATE auditoria_campo SET despues = 'x'`)));
    const del = await capturar(() => app((db) => db.execute(sql`DELETE FROM auditoria`)));
    expect([pgCode(ins), pgCode(upd), pgCode(del)]).toEqual(['42501', '42501', '42501']);
  });

  it('el código de pieza ya no se puede cambiar (UPDATE por columna)', async () => {
    const { piezaId } = await piezaBase();
    const e = await capturar(() =>
      editar({ adminId }, sql`UPDATE pieza SET codigo = 'XX01' WHERE id = ${piezaId}`),
    );
    expect(pgCode(e)).toBe('42501');
  });

  it('v_auditoria trae una fila por campo con el correo del admin', async () => {
    const { piezaId } = await piezaBase();
    await editar(
      { adminId, motivo: 'Ajuste' },
      sql`UPDATE pieza SET descripcion = 'Arete', costo = '10.00' WHERE id = ${piezaId}`,
    );
    const r = await app((db) =>
      db.execute<{ admin_email: string; campo: string; posicion: number }>(
        sql`SELECT admin_email, campo, posicion FROM v_auditoria WHERE entidad = 'pieza' AND entidad_id = ${piezaId} ORDER BY posicion`,
      ),
    );
    expect(r.rows).toEqual([
      { admin_email: 'auditor@kazero.test', campo: 'descripcion', posicion: 1 },
      { admin_email: 'auditor@kazero.test', campo: 'costo', posicion: 5 },
    ]);
  });

  it('renombrar un catálogo se audita', async () => {
    const { categoriaId } = await piezaBase();
    await editar(
      { adminId },
      sql`UPDATE categoria SET nombre = 'Anillos finos', version = version + 1 WHERE id = ${categoriaId}`,
    );
    expect((await bitacora(categoriaId)).map((f) => [f.entidad, f.campo, f.antes, f.despues])).toEqual([
      ['categoria', 'nombre', 'Anillos', 'Anillos finos'],
    ]);
  });
});

describe('corrección de estado en el trigger (R-07)', () => {
  async function exhibidorAbierto(nombre = 'Exh A') {
    return app(async (db) => {
      const [v] = await db
        .insert(vendedor)
        .values({ nombre: `V ${nombre}`, tipo: 'revendedora' })
        .returning({ id: vendedor.id });
      const [e] = await db
        .insert(exhibidor)
        .values({ vendedorId: v!.id, nombre, fechaEnvio: '2026-10-11' })
        .returning({ id: exhibidor.id });
      return e!.id;
    });
  }
  /** Simula lo que hacen los servicios: cambia la pieza e inserta su movimiento. */
  async function mover(
    piezaId: string,
    de: 'disponible' | 'en_exhibidor',
    a: 'regalo' | 'defecto' | 'guardada' | 'en_exhibidor',
    exhibidorId: string | null,
  ) {
    await app(async (db) => {
      await db
        .update(pieza)
        .set({ estado: a, exhibidorId: a === 'en_exhibidor' ? exhibidorId : null })
        .where(eq(pieza.id, piezaId));
      await db.insert(movimientoPieza).values({
        piezaId,
        tipo: a === 'en_exhibidor' ? 'envio_exhibidor' : 'cambio_estado',
        deEstado: de,
        aEstado: a,
        exhibidorId,
      });
    });
  }
  const a = (piezaId: string, estado: 'disponible' | 'en_exhibidor', exhibidorId: string | null = null) =>
    capturar(() => app((db) => db.update(pieza).set({ estado, exhibidorId }).where(eq(pieza.id, piezaId))));

  it('regalo → disponible solo si el último movimiento fue el cambio manual a regalo', async () => {
    const { piezaId } = await piezaBase();
    await mover(piezaId, 'disponible', 'regalo', null);
    expect(await a(piezaId, 'disponible')).toBeNull();
  });

  it('defecto → en_exhibidor vuelve solo al mismo exhibidor, y solo si sigue abierto', async () => {
    const { piezaId } = await piezaBase();
    const ex = await exhibidorAbierto('Exh A');
    const otro = await exhibidorAbierto('Exh B');
    await mover(piezaId, 'disponible', 'en_exhibidor', ex);
    await mover(piezaId, 'en_exhibidor', 'defecto', ex);
    expect(traducirErrorPg(await a(piezaId, 'en_exhibidor', otro))?.codigo).toBe('pieza_transicion');
    await owner((db) =>
      db.update(exhibidor).set({ estado: 'cerrado', cerradoAt: new Date() }).where(eq(exhibidor.id, ex)),
    );
    expect(traducirErrorPg(await a(piezaId, 'en_exhibidor', ex))?.codigo).toBe('pieza_transicion');
    await owner((db) =>
      db.update(exhibidor).set({ estado: 'abierto', cerradoAt: null }).where(eq(exhibidor.id, ex)),
    );
    expect(await a(piezaId, 'en_exhibidor', ex)).toBeNull();
  });

  it('guardada → en_exhibidor se rechaza si la pieza no venía de un exhibidor', async () => {
    const { piezaId } = await piezaBase();
    const ex = await exhibidorAbierto();
    await mover(piezaId, 'disponible', 'guardada', null);
    expect(traducirErrorPg(await a(piezaId, 'en_exhibidor', ex))?.codigo).toBe('pieza_transicion');
  });

  it('no se puede volver atrás si el último movimiento no es un cambio manual a ese estado', async () => {
    const { piezaId } = await piezaBase();
    await mover(piezaId, 'disponible', 'regalo', null);
    // Un movimiento posterior de otro tipo (p. ej. una corrección ya registrada) cierra la puerta.
    await app((db) =>
      db.insert(movimientoPieza).values({
        piezaId,
        tipo: 'correccion',
        deEstado: 'regalo',
        aEstado: 'regalo',
        nota: 'x',
        adminId,
      }),
    );
    expect(traducirErrorPg(await a(piezaId, 'disponible'))?.codigo).toBe('pieza_transicion');
  });

  it('regalo desde disponible no puede ir a un exhibidor', async () => {
    const { piezaId } = await piezaBase();
    const ex = await exhibidorAbierto();
    await mover(piezaId, 'disponible', 'regalo', null);
    expect(traducirErrorPg(await a(piezaId, 'en_exhibidor', ex))?.codigo).toBe('pieza_transicion');
  });

  it('regalo desde un exhibidor abierto vuelve a ese exhibidor, no a disponible (igual que destinoCorreccion)', async () => {
    const { piezaId } = await piezaBase();
    const ex = await exhibidorAbierto();
    await mover(piezaId, 'disponible', 'en_exhibidor', ex);
    await mover(piezaId, 'en_exhibidor', 'regalo', ex);
    expect(traducirErrorPg(await a(piezaId, 'disponible'))?.codigo).toBe('pieza_transicion');
    expect(await a(piezaId, 'en_exhibidor', ex)).toBeNull();
  });

  it('regalo desde un exhibidor ya cerrado solo vuelve a disponible', async () => {
    const { piezaId } = await piezaBase();
    const ex = await exhibidorAbierto();
    await mover(piezaId, 'disponible', 'en_exhibidor', ex);
    await mover(piezaId, 'en_exhibidor', 'regalo', ex);
    await owner((db) =>
      db.update(exhibidor).set({ estado: 'cerrado', cerradoAt: new Date() }).where(eq(exhibidor.id, ex)),
    );
    expect(traducirErrorPg(await a(piezaId, 'en_exhibidor', ex))?.codigo).toBe('pieza_transicion');
    expect(await a(piezaId, 'disponible')).toBeNull();
  });

  it('guardada desde un exhibidor cerrado no vuelve a él', async () => {
    const { piezaId } = await piezaBase();
    const ex = await exhibidorAbierto();
    await mover(piezaId, 'disponible', 'en_exhibidor', ex);
    await mover(piezaId, 'en_exhibidor', 'guardada', ex);
    await owner((db) =>
      db.update(exhibidor).set({ estado: 'cerrado', cerradoAt: new Date() }).where(eq(exhibidor.id, ex)),
    );
    expect(traducirErrorPg(await a(piezaId, 'en_exhibidor', ex))?.codigo).toBe('pieza_transicion');
  });

  it('una corrección exige admin y motivo (CHECK)', async () => {
    const { piezaId } = await piezaBase();
    const sinAdmin = await capturar(() =>
      app((db) =>
        db
          .insert(movimientoPieza)
          .values({ piezaId, tipo: 'correccion', deEstado: 'disponible', aEstado: 'disponible', nota: 'x' }),
      ),
    );
    const sinMotivo = await capturar(() =>
      app((db) =>
        db.insert(movimientoPieza).values({
          piezaId,
          tipo: 'correccion',
          deEstado: 'disponible',
          aEstado: 'disponible',
          nota: '  ',
          adminId,
        }),
      ),
    );
    expect(traducirErrorPg(sinAdmin)?.codigo).toBe('movimiento_correccion_completa');
    expect(traducirErrorPg(sinMotivo)?.codigo).toBe('movimiento_correccion_completa');
  });

  it('las transiciones normales siguen igual (R-03)', async () => {
    const { piezaId } = await piezaBase();
    const e = await capturar(() =>
      app((db) => db.update(pieza).set({ estado: 'vendida' }).where(eq(pieza.id, piezaId))),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('pieza_transicion');
  });
});

describe('endurecimiento de las funciones de la bitácora', () => {
  // Misma propiedad en todas las funciones SECURITY DEFINER (la bitácora y el libro de pagos).
  it.each(['kz_auditar', 'kz_validar_aplicacion_pago'])(
    '%s es SECURITY DEFINER del dueño, con search_path fijo y sin EXECUTE para PUBLIC ni kazero_app',
    async (funcion) => {
      const r = await owner((db) =>
        db.execute<{
          definer: boolean;
          config: string[] | null;
          dueno: boolean;
          app: boolean;
          publico: boolean;
        }>(sql`
        SELECT p.prosecdef AS definer, p.proconfig AS config,
               pg_get_userbyid(p.proowner) = current_user AS dueno,
               has_function_privilege('kazero_app', p.oid, 'EXECUTE') AS app,
               EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ${funcion}`),
      );
      expect(r.rows).toEqual([
        {
          definer: true,
          config: ['search_path=pg_catalog, public, pg_temp'],
          dueno: true,
          app: false,
          publico: false,
        },
      ]);
    },
  );

  it('un admin_id inexistente en el contexto no deja escribir (FK de la bitácora)', async () => {
    const { piezaId } = await piezaBase();
    const e = await capturar(() =>
      editar(
        { adminId: '00000000-0000-0000-0000-0000000000ff' },
        sql`UPDATE pieza SET descripcion = 'X' WHERE id = ${piezaId}`,
      ),
    );
    expect(pgCode(e)).toBe('23503');
  });

  it('una bandera de sesión no habilita la corrección: solo el historial', async () => {
    const { piezaId } = await piezaBase();
    await app(async (db) => {
      await db.update(pieza).set({ estado: 'regalo' }).where(eq(pieza.id, piezaId));
      await db
        .insert(movimientoPieza)
        .values({ piezaId, tipo: 'cambio_estado', deEstado: 'disponible', aEstado: 'regalo' });
      // El último movimiento ya no es el cambio manual a regalo: no hay nada que deshacer.
      await db.insert(movimientoPieza).values({
        piezaId,
        tipo: 'correccion',
        deEstado: 'regalo',
        aEstado: 'regalo',
        nota: 'x',
        adminId,
      });
    });
    const e = await capturar(() =>
      app((db) =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('kazero.admin_id', ${adminId}, true), set_config('kazero.motivo', 'correccion', true)`,
          );
          await tx.update(pieza).set({ estado: 'disponible' }).where(eq(pieza.id, piezaId));
        }),
      ),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('pieza_transicion');
  });
});

describe('movimientos coherentes con la pieza (trigger de movimiento_pieza)', () => {
  const insertar = (v: typeof movimientoPieza.$inferInsert) =>
    capturar(() => app((db) => db.insert(movimientoPieza).values(v)));
  const codigo = async (v: typeof movimientoPieza.$inferInsert) => traducirErrorPg(await insertar(v))?.codigo;
  async function exhibidorNuevo(nombre: string) {
    return app(async (db) => {
      const [v] = await db
        .insert(vendedor)
        .values({ nombre: `V ${nombre}`, tipo: 'revendedora' })
        .returning({ id: vendedor.id });
      const [e] = await db
        .insert(exhibidor)
        .values({ vendedorId: v!.id, nombre, fechaEnvio: '2026-10-11' })
        .returning({ id: exhibidor.id });
      return e!.id;
    });
  }

  it('a_estado debe ser el estado actual de la pieza', async () => {
    const { piezaId } = await piezaBase();
    expect(await codigo({ piezaId, tipo: 'cambio_estado', deEstado: 'disponible', aEstado: 'regalo' })).toBe(
      'movimiento_coherente',
    );
  });

  it('de_estado debe ser el a_estado del movimiento anterior', async () => {
    const { piezaId } = await piezaBase();
    await app((db) => db.update(pieza).set({ estado: 'regalo' }).where(eq(pieza.id, piezaId)));
    expect(await codigo({ piezaId, tipo: 'cambio_estado', deEstado: 'guardada', aEstado: 'regalo' })).toBe(
      'movimiento_coherente',
    );
    expect(await codigo({ piezaId, tipo: 'cambio_estado', aEstado: 'regalo' })).toBe('movimiento_coherente');
    expect(
      await insertar({ piezaId, tipo: 'cambio_estado', deEstado: 'disponible', aEstado: 'regalo' }),
    ).toBeNull();
  });

  it('el alta solo puede ser el primer movimiento y sin estado previo', async () => {
    const { piezaId } = await piezaBase();
    expect(await codigo({ piezaId, tipo: 'alta', aEstado: 'disponible' })).toBe('movimiento_coherente');
  });

  it('el exhibidor del movimiento coincide con el de la pieza y con el del envío anterior', async () => {
    const { piezaId } = await piezaBase();
    const ex = await exhibidorNuevo('Exh A');
    const otro = await exhibidorNuevo('Exh B');
    await app((db) =>
      db.update(pieza).set({ estado: 'en_exhibidor', exhibidorId: ex }).where(eq(pieza.id, piezaId)),
    );
    expect(
      await codigo({
        piezaId,
        tipo: 'envio_exhibidor',
        deEstado: 'disponible',
        aEstado: 'en_exhibidor',
        exhibidorId: otro,
      }),
    ).toBe('movimiento_coherente');
    expect(
      await insertar({
        piezaId,
        tipo: 'envio_exhibidor',
        deEstado: 'disponible',
        aEstado: 'en_exhibidor',
        exhibidorId: ex,
      }),
    ).toBeNull();
    await app((db) =>
      db.update(pieza).set({ estado: 'regalo', exhibidorId: null }).where(eq(pieza.id, piezaId)),
    );
    expect(
      await codigo({
        piezaId,
        tipo: 'cambio_estado',
        deEstado: 'en_exhibidor',
        aEstado: 'regalo',
        exhibidorId: otro,
      }),
    ).toBe('movimiento_coherente');
  });

  it('no se puede fabricar un cambio manual falso para luego "deshacerlo" hacia un exhibidor', async () => {
    const { piezaId } = await piezaBase();
    const ex = await exhibidorNuevo('Exh A');
    // La pieza nunca estuvo en el exhibidor: la app la pasa a regalo e inventa que venía de él.
    await app((db) => db.update(pieza).set({ estado: 'regalo' }).where(eq(pieza.id, piezaId)));
    expect(
      await codigo({
        piezaId,
        tipo: 'cambio_estado',
        deEstado: 'en_exhibidor',
        aEstado: 'regalo',
        exhibidorId: ex,
      }),
    ).toBe('movimiento_coherente');
    const e = await capturar(() =>
      app((db) =>
        db.update(pieza).set({ estado: 'en_exhibidor', exhibidorId: ex }).where(eq(pieza.id, piezaId)),
      ),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('pieza_transicion');
  });
});

describe('contexto de auditoría inválido', () => {
  it('un kazero.admin_id que no es uuid falla como "sin admin"', async () => {
    const { piezaId } = await piezaBase();
    const e = await capturar(() =>
      editar({ adminId: 'no-es-uuid' }, sql`UPDATE pieza SET descripcion = 'X' WHERE id = ${piezaId}`),
    );
    expect(traducirErrorPg(e)?.codigo).toBe('auditoria_sin_admin');
  });
});
