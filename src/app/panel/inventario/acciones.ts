'use server';

import { revalidatePath } from 'next/cache';
import { conDb } from '@/db/client';
import { mensajeCorreccion } from '@/domain/correccion';
import { pesosACentavos } from '@/domain/dinero';
import { parsearLote } from '@/domain/lote';
import type { EstadoAccion } from '@/features/ui/estado';
import { bytesDeArchivo, ejecutarAccion, texto, uuidDe, versionDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import { almacenImagenes } from '@/server/imagenes/almacen';
import { procesarImagen } from '@/server/imagenes/procesar';
import { altaPiezaConFoto, cambiarImagenPieza, quitarImagenPieza } from '@/server/piezas/imagen';
import {
  ESTADOS_MANUALES,
  altaLote,
  altaPieza,
  cambiarEstado,
  deshacerUltimoCambio,
  editarPieza,
  sugerirCodigo,
  type EstadoManual,
} from '@/server/piezas/servicio';
import type { EstadoLote } from './tipos';

/** Tope del texto pegado: 500 filas de ~400 caracteres caben de sobra; más es abuso. */
const MAX_CARACTERES_LOTE = 200_000;
const MAX_LINEAS_LOTE = 5_000;
const MAX_ERRORES_MOSTRADOS = 50;

export async function accionSugerirCodigo(prefijo: string): Promise<{ codigo?: string; error?: string }> {
  await requerirSesion();
  if (typeof prefijo !== 'string' || prefijo.length > 20)
    return { error: 'El prefijo debe tener de 1 a 6 letras.' };
  const r = await ejecutarAccion(() => conDb((db) => sugerirCodigo(db, prefijo)));
  return r.error ? { error: r.error } : { codigo: r.ok };
}

function monto(fd: FormData, campo: string, etiqueta: string, opcional = false): number {
  const t = texto(fd, campo).trim();
  if (!t && opcional) return 0;
  const c = pesosACentavos(t);
  if (c === null)
    throw new ErrorNegocio('monto', `${etiqueta}: escribe un monto válido (ej. 149 o 1,299.50).`, campo);
  return c;
}

function largoMax(fd: FormData, campo: string, etiqueta: string, max: number): string {
  const t = texto(fd, campo);
  if (t.length > max) throw new ErrorNegocio('largo', `${etiqueta}: máximo ${max} caracteres.`, campo);
  return t;
}

/**
 * Devuelve el código creado en `ok`; el cliente navega a la ficha y avisa al buscador (ver FormNuevaPieza).
 * Con `siguiente=otra` ("Guardar y agregar otra") devuelve además `siguiente: 'otra'` y el cliente se queda.
 * La foto es opcional y viaja en el mismo envío (D9).
 */
export async function accionAltaPieza(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  const otra = fd.get('siguiente') === 'otra';
  const r = await ejecutarAccion(async () => {
    const datos = {
      codigo: largoMax(fd, 'codigo', 'Código', 40),
      categoria: largoMax(fd, 'categoria', 'Categoría', 80),
      material: largoMax(fd, 'material', 'Material', 80),
      proveedor: largoMax(fd, 'proveedor', 'Proveedor', 80),
      descripcion: largoMax(fd, 'descripcion', 'Descripción', 300),
      costoCentavos: monto(fd, 'costo', 'Costo', true),
      precioCentavos: monto(fd, 'precio', 'Precio'),
    };
    // La foto se procesa ANTES de abrir la BD (CPU fuera de la conexión) y antes de subir nada.
    const bytes = await bytesDeArchivo(fd, 'imagen', { opcional: true });
    const imagen = bytes ? await procesarImagen(bytes) : null;
    // Sin foto no se toca el almacén (ni su configuración): el alta se comporta como antes.
    const p = await conDb((db) =>
      imagen ? altaPiezaConFoto(db, almacenImagenes(), datos, imagen) : altaPieza(db, datos),
    );
    revalidatePath('/panel/inventario');
    // Refresca las listas de categorías, materiales y proveedores de esta pantalla (uno nuevo aparece sin recargar).
    revalidatePath('/panel/inventario/nueva');
    return p.codigo;
  });
  return r.ok && otra ? { ...r, siguiente: 'otra' } : r;
}

export async function accionAltaLote(_: EstadoLote, fd: FormData): Promise<EstadoLote> {
  await requerirSesion();
  const r = await ejecutarAccion(async () => {
    const crudo = texto(fd, 'filas');
    if (crudo.length > MAX_CARACTERES_LOTE || crudo.split('\n', MAX_LINEAS_LOTE + 1).length > MAX_LINEAS_LOTE)
      throw new ErrorNegocio('lote', 'El texto pegado es demasiado grande. Máximo 500 piezas por lote.');
    const { filas, errores } = parsearLote(crudo);
    if (errores.length) {
      throw new ErrorNegocio(
        'lote_errores',
        errores.map((e) => (e.linea ? `Línea ${e.linea}: ${e.mensaje}` : e.mensaje)).join('\n'),
      );
    }
    const { creadas } = await conDb((db) => altaLote(db, filas));
    revalidatePath('/panel/inventario');
    return creadas === 1 ? '1 pieza dada de alta.' : `${creadas} piezas dadas de alta.`;
  });
  if (!r.error) return r;
  const todas = r.error.split('\n');
  if (todas.length === 1) return { error: r.error };
  const lineas = todas.slice(0, MAX_ERRORES_MOSTRADOS);
  if (todas.length > lineas.length) lineas.push(`… y ${todas.length - lineas.length} errores más.`);
  return { error: 'No se dio de alta nada. Corrige lo siguiente y vuelve a intentar:', lineas };
}

/** La ficha y el listado de piezas: ruta literal (precisa) y patrón (red de seguridad, lecciones §4). */
function revalidarPieza(codigo: string) {
  revalidatePath(`/panel/inventario/${encodeURIComponent(codigo)}`);
  revalidatePath('/panel/inventario/[codigo]', 'page');
  revalidatePath('/panel/inventario');
}

/** Sube o cambia la foto (también en piezas vendidas). El buscador lo marca sucio la UI (Task 6). */
export async function accionCambiarImagen(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const piezaId = uuidDe(fd, 'piezaId');
    const version = versionDe(fd);
    const imagen = await procesarImagen(await bytesDeArchivo(fd, 'imagen'));
    const { codigo } = await conDb((db) =>
      cambiarImagenPieza(db, almacenImagenes(), { piezaId, version, adminId, imagen }),
    );
    revalidarPieza(codigo);
    return 'Foto guardada.';
  });
}

export async function accionQuitarImagen(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    if (texto(fd, 'confirmo') !== 'si')
      throw new ErrorNegocio('sin_confirmacion', 'Confirma que quieres quitar la foto.', 'confirmo');
    const piezaId = uuidDe(fd, 'piezaId');
    const version = versionDe(fd);
    const r = await conDb((db) => quitarImagenPieza(db, almacenImagenes(), { piezaId, version, adminId }));
    if (r.cambios === 0) return 'Sin cambios.';
    revalidarPieza(r.codigo);
    return 'Foto quitada.';
  });
}

export async function accionCambiarEstado(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const aEstado = texto(fd, 'aEstado');
    if (!(ESTADOS_MANUALES as readonly string[]).includes(aEstado))
      throw new ErrorNegocio('pieza_transicion', 'Ese cambio de estado no está permitido para la pieza.');
    await conDb((db) =>
      cambiarEstado(db, {
        piezaId: uuidDe(fd, 'piezaId'),
        version: versionDe(fd),
        aEstado: aEstado as EstadoManual,
        nota: largoMax(fd, 'nota', 'Nota', 200),
        adminId,
      }),
    );
    revalidatePath('/panel/inventario/[codigo]', 'page');
    revalidatePath('/panel/inventario');
    return 'Estado actualizado.';
  });
}

export async function accionEditarPieza(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const { cambios, codigo } = await conDb((db) =>
      editarPieza(db, {
        piezaId: uuidDe(fd, 'piezaId'),
        version: versionDe(fd),
        adminId,
        motivo: largoMax(fd, 'motivo', 'Motivo', 200),
        categoria: largoMax(fd, 'categoria', 'Categoría', 80),
        material: largoMax(fd, 'material', 'Material', 80),
        proveedor: largoMax(fd, 'proveedor', 'Proveedor', 80),
        descripcion: largoMax(fd, 'descripcion', 'Descripción', 300),
        costoCentavos: monto(fd, 'costo', 'Costo', true),
        precioCentavos: monto(fd, 'precio', 'Precio'),
      }),
    );
    if (cambios === 0) return 'Sin cambios.';
    revalidarPieza(codigo);
    return 'Cambios guardados.';
  });
}

export async function accionDeshacerCambio(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    if (texto(fd, 'confirmo') !== 'si')
      throw new ErrorNegocio('sin_confirmacion', 'Confirma que quieres deshacer el cambio.', 'confirmo');
    const r = await conDb((db) =>
      deshacerUltimoCambio(db, {
        piezaId: uuidDe(fd, 'piezaId'),
        version: versionDe(fd),
        adminId,
        motivo: largoMax(fd, 'motivo', 'Motivo', 200),
      }),
    );
    revalidarPieza(r.codigo);
    // Puede volver a un exhibidor: cambia su lista y su conteo.
    revalidatePath('/panel/exhibidores/[id]', 'page');
    revalidatePath('/panel/exhibidores');
    return mensajeCorreccion(r);
  });
}
