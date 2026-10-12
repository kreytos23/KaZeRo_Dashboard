import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { historialDeCambios } from '@/server/auditoria/servicio';
import { crearCatalogo, listarCatalogo, renombrarCatalogo } from '@/server/catalogos/servicio';
import { actualizarCliente, crearCliente, obtenerCliente } from '@/server/clientes/servicio';
import {
  cerrarExhibidor,
  crearExhibidor,
  editarExhibidor,
  obtenerExhibidor,
} from '@/server/exhibidores/servicio';
import { altaPieza, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { actualizarVendedor, crearVendedor, obtenerVendedor } from '@/server/vendedores/servicio';
import { adminDePrueba, truncarTodo, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);

let adminId: string;
beforeEach(async () => {
  await truncarTodo();
  adminId = await adminDePrueba();
});

describe('vendedor (R-08, R-09)', () => {
  async function nelly() {
    const id = await app((db) =>
      crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18' }),
    );
    return (await app((db) => obtenerVendedor(db, id)))!;
  }
  it('cambiar la comisión exige motivo y queda en el historial', async () => {
    const v = await nelly();
    await expect(
      app((db) => actualizarVendedor(db, { ...v, adminId, comisionPct: '20' })),
    ).rejects.toMatchObject({
      codigo: 'motivo',
      campo: 'motivo',
    });
    expect(
      await app((db) =>
        actualizarVendedor(db, { ...v, adminId, comisionPct: '20', motivo: 'Nueva tabla 2026' }),
      ),
    ).toEqual({ cambios: 1 });
    const [e] = await app((db) => historialDeCambios(db, 'vendedor', v.id));
    expect(e).toMatchObject({
      motivo: 'Nueva tabla 2026',
      campos: [{ campo: 'comision_pct', antes: '18.00', despues: '20.00' }],
    });
  });
  it('"18" y "18.00" son la misma comisión: no-op sin motivo', async () => {
    const v = await nelly();
    expect(await app((db) => actualizarVendedor(db, { ...v, adminId, comisionPct: '18' }))).toEqual({
      cambios: 0,
    });
    expect((await app((db) => obtenerVendedor(db, v.id)))!.version).toBe(v.version);
  });
  it('nombre y activo no exigen motivo', async () => {
    const v = await nelly();
    await app((db) => actualizarVendedor(db, { ...v, adminId, nombre: 'Nelly R', activo: false }));
    const [e] = await app((db) => historialDeCambios(db, 'vendedor', v.id));
    expect(e!.campos.map((c) => [c.campo, c.antes, c.despues])).toEqual([
      ['nombre', 'Nelly', 'Nelly R'],
      ['activo', 'true', 'false'],
    ]);
  });
});

describe('cliente (R-08)', () => {
  it('registra el vendedor habitual por nombre y el teléfono', async () => {
    const vid = await app((db) =>
      crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18' }),
    );
    const id = await app((db) => crearCliente(db, { nombre: 'Danya', referencia: '5to norte' }));
    const c = (await app((db) => obtenerCliente(db, id)))!;
    expect(
      await app((db) =>
        actualizarCliente(db, { ...c, adminId, telefono: '5551234567', vendedorHabitualId: vid }),
      ),
    ).toEqual({ cambios: 2 });
    const [e] = await app((db) => historialDeCambios(db, 'cliente', id));
    expect(e).toMatchObject({
      motivo: null,
      campos: [
        { campo: 'telefono', antes: null, despues: '5551234567' },
        { campo: 'vendedor_habitual', antes: null, despues: 'Nelly' },
      ],
    });
  });
  it('guardar sin cambios no escribe ni sube la versión', async () => {
    const id = await app((db) => crearCliente(db, { nombre: 'Danya' }));
    const c = (await app((db) => obtenerCliente(db, id)))!;
    expect(await app((db) => actualizarCliente(db, { ...c, adminId, notas: '  ' }))).toEqual({ cambios: 0 });
    expect((await app((db) => obtenerCliente(db, id)))!.version).toBe(c.version);
  });
});

describe('exhibidor (D5)', () => {
  async function abierto() {
    const vendedorId = await app((db) =>
      crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18' }),
    );
    const id = await app((db) =>
      crearExhibidor(db, { vendedorId, nombre: 'Exh Nelly', fechaEnvio: '2026-09-16' }),
    );
    return (await app((db) => obtenerExhibidor(db, id)))!;
  }
  it('edita nombre y fecha de envío mientras está abierto', async () => {
    const e = await abierto();
    await app((db) =>
      editarExhibidor(db, {
        exhibidorId: e.id,
        version: e.version,
        adminId,
        nombre: 'Exh Nelly 16sep',
        fechaEnvio: '2026-09-17',
      }),
    );
    const [h] = await app((db) => historialDeCambios(db, 'exhibidor', e.id));
    expect(h!.campos).toEqual([
      { campo: 'nombre', antes: 'Exh Nelly', despues: 'Exh Nelly 16sep' },
      { campo: 'fecha_envio', antes: '2026-09-16', despues: '2026-09-17' },
    ]);
  });
  it('rechaza fechas imposibles y exhibidores cerrados', async () => {
    const e = await abierto();
    await expect(
      app((db) =>
        editarExhibidor(db, {
          exhibidorId: e.id,
          version: e.version,
          adminId,
          nombre: e.nombre,
          fechaEnvio: '2026-02-30',
        }),
      ),
    ).rejects.toMatchObject({ campo: 'fechaEnvio' });
    await app((db) => cerrarExhibidor(db, { exhibidorId: e.id, version: e.version }));
    await expect(
      app((db) =>
        editarExhibidor(db, {
          exhibidorId: e.id,
          version: e.version + 1,
          adminId,
          nombre: 'Otro',
          fechaEnvio: e.fechaEnvio,
        }),
      ),
    ).rejects.toThrow('Un exhibidor cerrado ya no se edita.');
  });
});

describe('catálogos (D6)', () => {
  it('renombrar actualiza las piezas (por la vista) y deja historial', async () => {
    await app((db) =>
      altaPieza(db, {
        codigo: 'CA01',
        categoria: 'Anillos',
        descripcion: 'Anillo',
        costoCentavos: 0,
        precioCentavos: 100,
      }),
    );
    const [c] = await app((db) => listarCatalogo(db, 'categoria'));
    expect(c).toMatchObject({ nombre: 'Anillos', version: 1 });
    await app((db) =>
      renombrarCatalogo(db, {
        tipo: 'categoria',
        id: c!.id,
        version: c!.version,
        adminId,
        nombre: 'Anillos finos',
      }),
    );
    expect((await app((db) => obtenerPiezaPorCodigo(db, 'CA01')))!.categoriaNombre).toBe('Anillos finos');
    const [h] = await app((db) => historialDeCambios(db, 'categoria', c!.id));
    expect(h!.campos).toEqual([{ campo: 'nombre', antes: 'Anillos', despues: 'Anillos finos' }]);
  });
  it('a un nombre que ya existe (sin importar acentos) → error en el campo', async () => {
    await app((db) => crearCatalogo(db, 'material', 'Oro laminado'));
    const id = await app((db) => crearCatalogo(db, 'material', 'Plata'));
    await expect(
      app((db) =>
        renombrarCatalogo(db, { tipo: 'material', id, version: 1, adminId, nombre: 'ORO LÁMINADO' }),
      ),
    ).rejects.toMatchObject({ message: 'Ese material ya existe.', campo: 'nombre' });
  });
  it('cambiar solo mayúsculas sí es un cambio; repetir el nombre no; versión vieja → conflicto', async () => {
    const id = await app((db) => crearCatalogo(db, 'proveedor', 'zabbel'));
    expect(
      await app((db) =>
        renombrarCatalogo(db, { tipo: 'proveedor', id, version: 1, adminId, nombre: 'zabbel' }),
      ),
    ).toEqual({ cambios: 0 });
    expect(
      await app((db) =>
        renombrarCatalogo(db, { tipo: 'proveedor', id, version: 1, adminId, nombre: 'ZABBEL' }),
      ),
    ).toEqual({ cambios: 1 });
    await expect(
      app((db) => renombrarCatalogo(db, { tipo: 'proveedor', id, version: 1, adminId, nombre: 'Zabbel' })),
    ).rejects.toThrow('Otra pestaña modificó este registro');
  });
});
