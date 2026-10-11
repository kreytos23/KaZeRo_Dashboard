import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import {
  crearCatalogo,
  listarCatalogo,
  obtenerOCrearCatalogo,
  resolverCatalogos,
} from '@/server/catalogos/servicio';
import { actualizarCliente, crearCliente, listarClientes, obtenerCliente } from '@/server/clientes/servicio';
import { ErrorNegocio } from '@/server/errores';
import {
  actualizarVendedor,
  crearVendedor,
  listarVendedores,
  obtenerVendedor,
} from '@/server/vendedores/servicio';
import { truncarTodo, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);

beforeEach(truncarTodo);

describe('catálogos', () => {
  it('obtenerOCrear reutiliza el existente aunque cambien mayúsculas y acentos', async () => {
    const a = await app((db) => obtenerOCrearCatalogo(db, 'proveedor', 'Zabbel'));
    const b = await app((db) => obtenerOCrearCatalogo(db, 'proveedor', ' ZABBEL '));
    expect(b).toBe(a);
    expect(await app((db) => listarCatalogo(db, 'proveedor'))).toEqual([{ id: a, nombre: 'Zabbel' }]);
  });
  it('crear rechaza duplicados con mensaje de negocio', async () => {
    await app((db) => crearCatalogo(db, 'material', 'Oro laminado'));
    await expect(app((db) => crearCatalogo(db, 'material', 'ORO LAMINADO'))).rejects.toThrow(
      'Ese material ya existe.',
    );
  });
  it('rechaza nombres vacíos', async () => {
    await expect(app((db) => crearCatalogo(db, 'categoria', '   '))).rejects.toBeInstanceOf(ErrorNegocio);
  });
  it('resuelve muchos nombres en lote reutilizando los existentes (sin N+1)', async () => {
    const zabbel = await app((db) => obtenerOCrearCatalogo(db, 'proveedor', 'Zabbel'));
    const m = await app((db) => resolverCatalogos(db, 'proveedor', ['ZABBEL', 'Roel Joyas', 'roel   joyas']));
    expect(m.size).toBe(2);
    expect(m.get('zabbel')).toBe(zabbel);
    expect(m.get('roel joyas')).toEqual(expect.any(String));
    expect(await app((db) => listarCatalogo(db, 'proveedor'))).toHaveLength(2);
  });
});

describe('vendedores (R-40)', () => {
  it('crea, lista y edita la comisión con bloqueo optimista', async () => {
    const id = await app((db) =>
      crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '15.00' }),
    );
    const v = await app((db) => obtenerVendedor(db, id));
    expect(v).toMatchObject({ nombre: 'Nelly', comisionPct: '15.00', activo: true, version: 1 });
    await app((db) => actualizarVendedor(db, { ...v!, comisionPct: '18.00' }));
    expect((await app((db) => obtenerVendedor(db, id)))?.comisionPct).toBe('18.00');
    // La misma versión vieja ya no sirve: otra pestaña la modificó.
    await expect(app((db) => actualizarVendedor(db, { ...v!, comisionPct: '20.00' }))).rejects.toThrow(
      'Otra pestaña modificó este registro',
    );
  });
  it('nombres únicos sin importar mayúsculas', async () => {
    await app((db) => crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' }));
    await expect(
      app((db) => crearVendedor(db, { nombre: 'NELLY', tipo: 'casa', comisionPct: '0.00' })),
    ).rejects.toThrow('Ya existe un vendedor con ese nombre.');
  });
  it('valida la comisión antes de la BD, con mensaje claro', async () => {
    const mensaje = 'La comisión debe ser un número entre 0 y 100 con hasta 2 decimales.';
    for (const comisionPct of ['abc', '10%', '', '100.01', '-1', '1.234', '1e2']) {
      await expect(
        app((db) => crearVendedor(db, { nombre: 'Rosa', tipo: 'casa', comisionPct })),
      ).rejects.toThrow(mensaje);
    }
    const id = await app((db) => crearVendedor(db, { nombre: 'Rosa', tipo: 'casa', comisionPct: '12.5' }));
    const v = (await app((db) => obtenerVendedor(db, id)))!;
    await expect(app((db) => actualizarVendedor(db, { ...v, comisionPct: '10%' }))).rejects.toThrow(mensaje);
  });
  it('soloActivos filtra los inactivos', async () => {
    const id = await app((db) =>
      crearVendedor(db, { nombre: 'BLNail', tipo: 'consignacion', comisionPct: '18.00' }),
    );
    const v = (await app((db) => obtenerVendedor(db, id)))!;
    await app((db) => actualizarVendedor(db, { ...v, activo: false }));
    expect(await app((db) => listarVendedores(db, { soloActivos: true }))).toEqual([]);
  });
});

describe('clientes (R-70)', () => {
  it('alta rápida con solo el nombre', async () => {
    const id = await app((db) => crearCliente(db, { nombre: 'Gloria Roldan' }));
    expect(await app((db) => obtenerCliente(db, id))).toMatchObject({ nombre: 'Gloria Roldan', notas: '' });
  });
  it('vendedor habitual y edición con versión', async () => {
    const vid = await app((db) =>
      crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' }),
    );
    const id = await app((db) => crearCliente(db, { nombre: 'Danya', referencia: '5to norte' }));
    const c = (await app((db) => obtenerCliente(db, id)))!;
    await app((db) => actualizarCliente(db, { ...c, vendedorHabitualId: vid, cumpleanos: '1990-05-17' }));
    expect(await app((db) => obtenerCliente(db, id))).toMatchObject({
      vendedorHabitualNombre: 'Nelly',
      cumpleanos: '1990-05-17',
      version: 2,
    });
  });
  it('rechaza un cumpleaños imposible', async () => {
    await expect(app((db) => crearCliente(db, { nombre: 'X', cumpleanos: '2026-02-30' }))).rejects.toThrow(
      'La fecha de cumpleaños no es válida.',
    );
  });
  it('busca sin acentos por nombre y referencia, y trata % como texto', async () => {
    await app((db) => crearCliente(db, { nombre: 'Rocío Santibañez' }));
    await app((db) => crearCliente(db, { nombre: 'Danya', referencia: '5to norte' }));
    await app((db) => crearCliente(db, { nombre: '100% Real' }));
    expect((await app((db) => listarClientes(db, { q: 'santibanez' }))).map((c) => c.nombre)).toEqual([
      'Rocío Santibañez',
    ]);
    expect((await app((db) => listarClientes(db, { q: '5TO NORTE' }))).map((c) => c.nombre)).toEqual([
      'Danya',
    ]);
    expect((await app((db) => listarClientes(db, { q: '%' }))).map((c) => c.nombre)).toEqual(['100% Real']);
  });
});
