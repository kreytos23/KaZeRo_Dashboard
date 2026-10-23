'use server';

import { revalidatePath } from 'next/cache';
import { conDb } from '@/db/client';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe, uuidOpcionalDe, versionDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import { actualizarCliente, crearCliente } from '@/server/clientes/servicio';
import { retirarSaldoFavor } from '@/server/saldo-favor/servicio';
import { pesosACentavos } from '@/domain/dinero';

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

export async function accionRetirarSaldoFavor(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const clienteId = uuidDe(fd, 'clienteId');
    // Dinero que sale de la caja: la casilla `required` no basta, un POST directo la saltaría.
    if (texto(fd, 'confirmo') !== 'on')
      throw new ErrorNegocio('confirmacion', 'Marca la casilla para confirmar que entregaste el efectivo.');
    const bruto = texto(fd, 'monto').trim();
    const monto = pesosACentavos(bruto);
    if (monto === null || monto <= 0)
      throw new ErrorNegocio('monto_invalido', 'Escribe un monto válido, por ejemplo 149 o 149.50.', 'monto');
    await conDb((db) =>
      retirarSaldoFavor(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        clienteId,
        montoCentavos: monto,
        nota: texto(fd, 'nota').slice(0, 400),
      }),
    );
    revalidatePath(`/panel/clientes/${clienteId}`);
    revalidatePath('/panel/clientes');
    return 'Retiro registrado.';
  });
}
