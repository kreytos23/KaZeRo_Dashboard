'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { conDb } from '@/db/client';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe, versionDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { crearCatalogo, renombrarCatalogo } from '@/server/catalogos/servicio';
import { ErrorNegocio } from '@/server/errores';

const tipoCatalogo = z.enum(['categoria', 'material', 'proveedor']);

export async function accionCrearCatalogo(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const tipo = tipoCatalogo.safeParse(texto(fd, 'tipo'));
    if (!tipo.success) throw new ErrorNegocio('tipo', 'Tipo de catálogo no válido.');
    await conDb((db) => crearCatalogo(db, tipo.data, texto(fd, 'nombre')));
    revalidatePath('/panel/catalogos');
    return 'Agregado.';
  });
}

export async function accionRenombrarCatalogo(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const tipo = tipoCatalogo.safeParse(texto(fd, 'tipo'));
    if (!tipo.success) throw new ErrorNegocio('tipo', 'Tipo de catálogo no válido.');
    const { cambios } = await conDb((db) =>
      renombrarCatalogo(db, {
        tipo: tipo.data,
        id: uuidDe(fd, 'id'),
        version: versionDe(fd),
        adminId,
        motivo: texto(fd, 'motivo'),
        nombre: texto(fd, 'nombre'),
      }),
    );
    if (cambios === 0) return 'Sin cambios.';
    revalidatePath('/panel/catalogos');
    // El nombre del catálogo se ve en el listado y en cada ficha de pieza.
    revalidatePath('/panel/inventario');
    revalidatePath('/panel/inventario/[codigo]', 'page');
    revalidatePath('/panel/inventario/nueva');
    return 'Nombre actualizado.';
  });
}
