import { beforeEach, describe, expect, it } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { rutaImagen } from '@/domain/imagenes';
import { barrerImagenesHuerfanas } from '@/server/imagenes/barrido';
import { procesarImagen } from '@/server/imagenes/procesar';
import { cambiarImagenPieza, clavesDeImagenReferenciadas } from '@/server/piezas/imagen';
import { altaPieza, obtenerPiezaPorCodigo } from '@/server/piezas/servicio';
import { crearAlmacenMemoria } from '../apoyo/almacen-memoria';
import { jpegDePrueba } from '../apoyo/imagenes';
import { adminDePrueba, truncarTodo, urlApp } from './utilidades';

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);

const base = { categoria: 'Anillos', descripcion: 'Anillo luna', costoCentavos: 0, precioCentavos: 14900 };

let adminId: string;
beforeEach(async () => {
  await truncarTodo();
  adminId = await adminDePrueba();
});

describe('barrido contra la BD real', () => {
  it('una consulta trae las claves vigentes; tras 25 h solo sobreviven las de la foto actual', async () => {
    const ayer = new Date(Date.now() - 25 * 3_600_000);
    const almacen = crearAlmacenMemoria({ ahora: () => ayer });
    const foto = await procesarImagen(await jpegDePrueba());
    await app((db) => altaPieza(db, { ...base, codigo: 'BR01' }));
    const p = (await app((db) => obtenerPiezaPorCodigo(db, 'BR01')))!;
    await app((db) =>
      cambiarImagenPieza(db, almacen, { piezaId: p.id, version: p.version, adminId, imagen: foto }),
    );
    const huerfana = '11111111-1111-4111-8111-111111111111';
    almacen.sembrar(rutaImagen(p.id, huerfana, 'grande'), ayer); // p. ej. un borrado que falló

    const claves = await app((db) => clavesDeImagenReferenciadas(db));
    const vigente = (await app((db) => obtenerPiezaPorCodigo(db, 'BR01')))!.imagenClave!;
    expect([...claves]).toEqual([vigente]);

    const r = await barrerImagenesHuerfanas({
      almacen,
      clavesReferenciadas: () => app(clavesDeImagenReferenciadas),
    });
    expect(r).toMatchObject({ referenciados: 2, borrados: 1 });
    expect(almacen.rutas()).toEqual(
      [rutaImagen(p.id, vigente, 'grande'), rutaImagen(p.id, vigente, 'mini')].sort(),
    );
  });
});
