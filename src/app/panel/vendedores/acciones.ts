'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { conDb } from '@/db/client';
import { porcentajeANumeric } from '@/domain/dinero';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe, versionDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import { actualizarVendedor, crearVendedor } from '@/server/vendedores/servicio';

const tipo = z.enum(['casa', 'revendedora', 'consignacion']);

function leer(fd: FormData) {
  const t = tipo.safeParse(texto(fd, 'tipo'));
  if (!t.success) throw new ErrorNegocio('tipo', 'Elige un tipo de vendedor.', 'tipo');
  const bruto = texto(fd, 'comision');
  // El servicio vuelve a validar y da el mensaje de error si no es un porcentaje.
  return { nombre: texto(fd, 'nombre'), tipo: t.data, comisionPct: porcentajeANumeric(bruto) ?? bruto };
}

export async function accionCrearVendedor(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const datos = leer(fd);
    await conDb((db) => crearVendedor(db, datos));
    revalidatePath('/panel/vendedores');
    return 'Vendedor agregado.';
  });
}

export async function accionEditarVendedor(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const id = uuidDe(fd, 'id');
    const version = versionDe(fd);
    const datos = leer(fd);
    await conDb((db) => actualizarVendedor(db, { id, version, activo: fd.get('activo') === 'on', ...datos }));
    revalidatePath(`/panel/vendedores/${id}`);
    revalidatePath('/panel/vendedores');
    return 'Cambios guardados.';
  });
}
