'use server';

import { revalidatePath } from 'next/cache';
import { conDb } from '@/db/client';
import { pesosACentavos } from '@/domain/dinero';
import { parsearLote } from '@/domain/lote';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe, versionDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import {
  ESTADOS_MANUALES,
  altaLote,
  altaPieza,
  cambiarEstado,
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

/** Devuelve el código creado en `ok`; el cliente navega a la ficha y avisa al buscador (ver FormNuevaPieza). */
export async function accionAltaPieza(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const p = await conDb((db) =>
      altaPieza(db, {
        codigo: largoMax(fd, 'codigo', 'Código', 40),
        categoria: largoMax(fd, 'categoria', 'Categoría', 80),
        material: largoMax(fd, 'material', 'Material', 80),
        proveedor: largoMax(fd, 'proveedor', 'Proveedor', 80),
        descripcion: largoMax(fd, 'descripcion', 'Descripción', 300),
        costoCentavos: monto(fd, 'costo', 'Costo', true),
        precioCentavos: monto(fd, 'precio', 'Precio'),
      }),
    );
    revalidatePath('/panel/inventario');
    return p.codigo;
  });
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

export async function accionCambiarEstado(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
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
      }),
    );
    revalidatePath('/panel/inventario/[codigo]', 'page');
    revalidatePath('/panel/inventario');
    return 'Estado actualizado.';
  });
}
