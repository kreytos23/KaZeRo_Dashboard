import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { aplicarTarjetas, simularTarjetas } from '../../scripts/importar-tarjetas/bd';
import type { FilaTarjeta } from '../../scripts/importar-tarjetas/leer';
import { conDbUrl } from '@/db/pool';
import { crearCliente } from '@/server/clientes/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { reiniciarConAdmin, urlApp, urlOwner } from './utilidades';

// Datos SINTÉTICOS.
const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
const filas: FilaTarjeta[] = [
  { fila: 4, nombre: 'Ana', apellido: 'Uno', compras: 4, vendedor: 'Perla' },
  { fila: 5, nombre: 'Bea', apellido: 'Dos', compras: 9, vendedor: 'Perla' },
];
const leer = () =>
  conDbUrl(urlOwner(), (db) =>
    db.execute(
      sql`SELECT nombre, compras_previas AS previas, vendedor_habitual_id IS NOT NULL AS con_vendedora FROM cliente WHERE NOT es_mostrador ORDER BY compras_previas, nombre`,
    ),
  ).then((r) => r.rows);

beforeEach(async () => {
  await reiniciarConAdmin();
  await app((db) =>
    crearVendedor(db, { nombre: 'Perla Ejemplo', tipo: 'revendedora', comisionPct: '10.00' }),
  );
  await app((db) => crearCliente(db, { nombre: 'Ána UNO' }));
});

describe('importación de tarjetas', () => {
  it('simular no escribe', async () => {
    const p = await simularTarjetas(urlOwner(), filas);
    expect(p).toMatchObject({ errores: [], sinCambios: 0 });
    expect(p.crear).toHaveLength(1);
    expect(p.actualizar).toHaveLength(1);
    expect(await leer()).toEqual([{ nombre: 'Ána UNO', previas: 0, con_vendedora: false }]);
  });

  it('ensayo deshace todo', async () => {
    const r = await aplicarTarjetas(urlOwner(), filas, { modo: 'ensayo' });
    expect(r).toMatchObject({ creadas: 1, actualizadas: 1 });
    expect(await leer()).toEqual([{ nombre: 'Ána UNO', previas: 0, con_vendedora: false }]);
  });

  it('aplicar crea y actualiza; una segunda corrida no cambia nada', async () => {
    const plan = await simularTarjetas(urlOwner(), filas);
    await aplicarTarjetas(urlOwner(), filas, { modo: 'aplicar', hashEsperado: plan.hash });
    expect(await leer()).toEqual([
      { nombre: 'Ána UNO', previas: 4, con_vendedora: true },
      { nombre: 'Bea Dos', previas: 9, con_vendedora: true },
    ]);
    const otra = await simularTarjetas(urlOwner(), filas);
    expect(otra).toMatchObject({ crear: [], actualizar: [], sinCambios: 2 });
  });

  it('aplicar con otro hash no escribe', async () => {
    await expect(
      aplicarTarjetas(urlOwner(), filas, { modo: 'aplicar', hashEsperado: 'otro' }),
    ).rejects.toThrow(/plan cambió/);
    expect(await leer()).toHaveLength(1);
  });

  it('ensayo con otro hash no escribe', async () => {
    await expect(
      aplicarTarjetas(urlOwner(), filas, { modo: 'ensayo', hashEsperado: 'otro' }),
    ).rejects.toThrow(/plan cambió/);
    expect(await leer()).toEqual([{ nombre: 'Ána UNO', previas: 0, con_vendedora: false }]);
  });

  it('con errores no escribe nada', async () => {
    await expect(
      aplicarTarjetas(
        urlOwner(),
        [...filas, { fila: 6, nombre: 'Eva', apellido: 'Tres', compras: 12, vendedor: 'Perla' }],
        { modo: 'ensayo' },
      ),
    ).rejects.toThrow(/errores/);
  });

  it('el cambio de la existente queda en su historial con el motivo de la importación', async () => {
    const plan = await simularTarjetas(urlOwner(), filas);
    await aplicarTarjetas(urlOwner(), filas, { modo: 'aplicar', hashEsperado: plan.hash });
    const h = await conDbUrl(urlOwner(), (db) =>
      db.execute(
        sql`SELECT a.motivo, c.campo FROM auditoria a JOIN auditoria_campo c ON c.auditoria_id = a.id ORDER BY c.campo`,
      ),
    ).then((r) => r.rows);
    expect(h).toEqual([
      { motivo: 'Importación de tarjetas (Excel, 2026-11)', campo: 'compras_previas' },
      { motivo: 'Importación de tarjetas (Excel, 2026-11)', campo: 'vendedor_habitual' },
    ]);
  });
});
