import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import {
  cerrarExhibidor,
  crearExhibidor,
  enviarPiezas,
  listarExhibidores,
  obtenerExhibidor,
  regresarPiezas,
} from '@/server/exhibidores/servicio';
import { altaPieza, historial, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { actualizarVendedor, crearVendedor, obtenerVendedor } from '@/server/vendedores/servicio';
import { truncarTodo, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);

async function preparar() {
  const vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' }),
  );
  for (const codigo of ['EX01', 'EX02', 'EX03']) {
    await app((db) =>
      altaPieza(db, {
        codigo,
        categoria: 'Anillos',
        descripcion: `Anillo ${codigo}`,
        costoCentavos: 0,
        precioCentavos: 14900,
      }),
    );
  }
  const exhibidorId = await app((db) =>
    crearExhibidor(db, { vendedorId, nombre: 'Exhibidor Nelly - 16sep', fechaEnvio: '2026-09-16' }),
  );
  return { vendedorId, exhibidorId };
}

const estadoDe = async (codigo: string) => (await app((db) => obtenerPiezaPorCodigo(db, codigo)))!.estado;

beforeEach(truncarTodo);

describe('exhibidores', () => {
  it('envía piezas en ráfaga, las marca en exhibidor y deja historial', async () => {
    const { exhibidorId } = await preparar();
    expect(await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['ex01', ' EX02 '] }))).toEqual({
      enviadas: 2,
    });
    const p = (await app((db) => obtenerPiezaPorCodigo(db, 'EX01')))!;
    expect(p).toMatchObject({ estado: 'en_exhibidor', exhibidorNombre: 'Exhibidor Nelly - 16sep' });
    expect((await app((db) => historial(db, p.id)))[0]).toMatchObject({
      tipo: 'envio_exhibidor',
      deEstado: 'disponible',
      aEstado: 'en_exhibidor',
      exhibidorNombre: 'Exhibidor Nelly - 16sep',
    });
    const e = (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
    expect(e.piezasActuales).toBe(2);
    expect(e.piezas.map((x) => x.codigo)).toEqual(['EX01', 'EX02']);
  });

  it('todo o nada: un código inexistente o no disponible aborta el envío y no cambia nada', async () => {
    const { exhibidorId } = await preparar();
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['EX01'] }));
    await expect(
      app((db) => enviarPiezas(db, { exhibidorId, codigos: ['EX02', 'EX01', 'NOEXISTE'] })),
    ).rejects.toThrow('No se envió nada. No existen: NOEXISTE. No están disponibles: EX01 (en_exhibidor).');
    expect(await estadoDe('EX02')).toBe('disponible');
    const ex02 = (await app((db) => obtenerPiezaPorCodigo(db, 'EX02')))!;
    expect(await app((db) => historial(db, ex02.id))).toHaveLength(1); // solo el alta
    expect((await app((db) => obtenerExhibidor(db, exhibidorId)))!.piezasActuales).toBe(1);
  });

  it('rechaza listas vacías, repetidas tras normalizar y demasiado largas antes de tocar la BD', async () => {
    const { exhibidorId } = await preparar();
    await expect(app((db) => enviarPiezas(db, { exhibidorId, codigos: [' ', ''] }))).rejects.toThrow(
      'Escribe al menos un código.',
    );
    await expect(app((db) => enviarPiezas(db, { exhibidorId, codigos: ['ex01', ' EX01 '] }))).rejects.toThrow(
      'Códigos repetidos: EX01.',
    );
    await expect(app((db) => regresarPiezas(db, { exhibidorId, codigos: ['ex01', 'EX01'] }))).rejects.toThrow(
      'Códigos repetidos: EX01.',
    );
    const muchos = Array.from({ length: 501 }, (_, i) => `M${i}`);
    await expect(app((db) => enviarPiezas(db, { exhibidorId, codigos: muchos }))).rejects.toThrow(
      'Máximo 500 piezas por operación.',
    );
    expect(await estadoDe('EX01')).toBe('disponible');
  });

  it('rechaza exhibidor inexistente y vendedor inactivo', async () => {
    const { vendedorId, exhibidorId } = await preparar();
    await expect(
      app((db) =>
        enviarPiezas(db, { exhibidorId: '00000000-0000-4000-8000-000000000000', codigos: ['EX01'] }),
      ),
    ).rejects.toThrow('El exhibidor no existe.');
    const v = (await app((db) => obtenerVendedor(db, vendedorId)))!;
    await app((db) =>
      actualizarVendedor(db, {
        id: v.id,
        version: v.version,
        nombre: v.nombre,
        tipo: v.tipo,
        comisionPct: v.comisionPct,
        activo: false,
      }),
    );
    await expect(app((db) => enviarPiezas(db, { exhibidorId, codigos: ['EX01'] }))).rejects.toThrow(
      'El vendedor del exhibidor está inactivo.',
    );
    expect(await estadoDe('EX01')).toBe('disponible');
  });

  it('regresa solo piezas de ese exhibidor y registra de cuál salieron', async () => {
    const { vendedorId, exhibidorId } = await preparar();
    const otro = await app((db) =>
      crearExhibidor(db, { vendedorId, nombre: 'Otro', fechaEnvio: '2026-10-01' }),
    );
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['EX01'] }));
    await app((db) => enviarPiezas(db, { exhibidorId: otro, codigos: ['EX02'] }));
    await expect(
      app((db) => regresarPiezas(db, { exhibidorId, codigos: ['EX01', 'EX02', 'EX03'] })),
    ).rejects.toThrow('No se regresó nada. No están en este exhibidor: EX02, EX03.');
    expect(await estadoDe('EX01')).toBe('en_exhibidor'); // todo o nada
    expect(await app((db) => regresarPiezas(db, { exhibidorId, codigos: ['EX01'] }))).toEqual({
      regresadas: 1,
    });
    const p = (await app((db) => obtenerPiezaPorCodigo(db, 'EX01')))!;
    expect(p).toMatchObject({ estado: 'disponible', exhibidorNombre: null });
    expect((await app((db) => historial(db, p.id)))[0]).toMatchObject({
      tipo: 'regreso',
      deEstado: 'en_exhibidor',
      aEstado: 'disponible',
      exhibidorNombre: 'Exhibidor Nelly - 16sep',
    });
  });

  it('solo se cierra sin piezas, y cerrado no recibe más', async () => {
    const { exhibidorId } = await preparar();
    await app((db) => enviarPiezas(db, { exhibidorId, codigos: ['EX01'] }));
    let e = (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
    await expect(app((db) => cerrarExhibidor(db, { exhibidorId, version: e.version }))).rejects.toThrow(
      'Regresa o vende sus 1 piezas antes de cerrarlo.',
    );
    await app((db) => regresarPiezas(db, { exhibidorId, codigos: ['EX01'] }));
    e = (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
    await app((db) => cerrarExhibidor(db, { exhibidorId, version: e.version }));
    await expect(app((db) => enviarPiezas(db, { exhibidorId, codigos: ['EX02'] }))).rejects.toThrow(
      'El exhibidor está cerrado.',
    );
    expect((await app((db) => listarExhibidores(db, {})))[0]).toMatchObject({
      estado: 'cerrado',
      piezasActuales: 0,
    });
  });

  it('cerrar con una versión vieja es conflicto', async () => {
    const { exhibidorId } = await preparar();
    const e = (await app((db) => obtenerExhibidor(db, exhibidorId)))!;
    await app((db) => cerrarExhibidor(db, { exhibidorId, version: e.version }));
    await expect(app((db) => cerrarExhibidor(db, { exhibidorId, version: e.version }))).rejects.toThrow(
      'Otra pestaña modificó este registro. Recarga la página.',
    );
  });

  it('rechaza fechas imposibles', async () => {
    const vendedorId = await app((db) =>
      crearVendedor(db, { nombre: 'DH', tipo: 'consignacion', comisionPct: '20.00' }),
    );
    await expect(
      app((db) => crearExhibidor(db, { vendedorId, nombre: 'X', fechaEnvio: '2026-02-30' })),
    ).rejects.toThrow('La fecha de envío no es válida.');
  });
});
