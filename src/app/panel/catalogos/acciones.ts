'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { conDb } from '@/db/client';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { crearCatalogo } from '@/server/catalogos/servicio';
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
