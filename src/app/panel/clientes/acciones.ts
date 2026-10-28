'use server';

import { revalidatePath } from 'next/cache';
import { conDb } from '@/db/client';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe, uuidOpcionalDe, versionDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { actualizarCliente, crearCliente } from '@/server/clientes/servicio';

export async function accionCrearCliente(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    await conDb((db) =>
      crearCliente(db, { nombre: texto(fd, 'nombre'), referencia: texto(fd, 'referencia') }),
    );
    revalidatePath('/panel/clientes');
    return 'Cliente agregado.';
  });
}

export async function accionEditarCliente(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const id = uuidDe(fd, 'id');
    const version = versionDe(fd);
    const vendedorHabitualId = uuidOpcionalDe(fd, 'vendedorHabitualId');
    const { cambios } = await conDb((db) =>
      actualizarCliente(db, {
        id,
        version,
        adminId,
        motivo: texto(fd, 'motivo'),
        nombre: texto(fd, 'nombre'),
        referencia: texto(fd, 'referencia'),
        telefono: texto(fd, 'telefono'),
        cumpleanos: texto(fd, 'cumpleanos'),
        redSocial: texto(fd, 'redSocial'),
        usuarioRed: texto(fd, 'usuarioRed'),
        vendedorHabitualId,
        notas: texto(fd, 'notas'),
      }),
    );
    if (cambios === 0) return 'Sin cambios.';
    revalidatePath(`/panel/clientes/${id}`);
    revalidatePath('/panel/clientes');
    return 'Cambios guardados.';
  });
}
