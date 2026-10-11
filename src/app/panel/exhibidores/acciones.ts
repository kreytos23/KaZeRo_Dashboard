'use server';

import { revalidatePath } from 'next/cache';
import { conDb } from '@/db/client';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe, versionDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import { cerrarExhibidor, crearExhibidor, enviarPiezas, regresarPiezas } from '@/server/exhibidores/servicio';

/** 500 códigos de hasta 20 caracteres con separadores caben de sobra; más es abuso. */
const MAX_CARACTERES_CODIGOS = 20_000;

/** Corta el tamaño ANTES de partir el texto; separadores: saltos de línea, comas, espacios y tabuladores. */
function codigosDe(fd: FormData): string[] {
  const crudo = texto(fd, 'codigos');
  if (crudo.length > MAX_CARACTERES_CODIGOS)
    throw new ErrorNegocio('sin_codigos', 'El texto de códigos es demasiado grande. Máximo 500 piezas.');
  return crudo.split(/[\s,]+/).filter(Boolean);
}

const piezas = (n: number, participio: 'enviada' | 'regresada') =>
  n === 1 ? `1 pieza ${participio}.` : `${n} piezas ${participio}s.`;

/** Una pieza cambió de estado: se refrescan la ficha, el listado y el inventario. */
function revalidarPiezas(exhibidorId: string) {
  revalidatePath(`/panel/exhibidores/${exhibidorId}`);
  revalidatePath('/panel/exhibidores');
  revalidatePath('/panel/inventario');
  revalidatePath('/panel/inventario/[codigo]', 'page');
}

export async function accionCrearExhibidor(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    if (texto(fd, 'nombre').length > 200)
      throw new ErrorNegocio('exhibidor_invalido', 'El nombre debe tener entre 1 y 120 caracteres.');
    await conDb((db) =>
      crearExhibidor(db, {
        vendedorId: uuidDe(fd, 'vendedorId'),
        nombre: texto(fd, 'nombre'),
        fechaEnvio: texto(fd, 'fechaEnvio').slice(0, 20),
      }),
    );
    revalidatePath('/panel/exhibidores');
    revalidatePath('/panel/vendedores/[id]', 'page');
    return 'Exhibidor creado.';
  });
}

export async function accionEnviar(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    const { enviadas } = await conDb((db) => enviarPiezas(db, { exhibidorId, codigos: codigosDe(fd) }));
    revalidarPiezas(exhibidorId);
    return piezas(enviadas, 'enviada');
  });
}

export async function accionRegresar(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    const { regresadas } = await conDb((db) => regresarPiezas(db, { exhibidorId, codigos: codigosDe(fd) }));
    revalidarPiezas(exhibidorId);
    return piezas(regresadas, 'regresada');
  });
}

export async function accionCerrar(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    const version = versionDe(fd);
    if (texto(fd, 'confirmo') !== 'si')
      throw new ErrorNegocio('sin_confirmacion', 'Confirma que quieres cerrar el exhibidor.');
    await conDb((db) => cerrarExhibidor(db, { exhibidorId, version }));
    revalidarPiezas(exhibidorId);
    return 'Exhibidor cerrado.';
  });
}
