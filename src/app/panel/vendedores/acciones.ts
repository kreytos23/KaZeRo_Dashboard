'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { conDb } from '@/db/client';
import { porcentajeANumeric } from '@/domain/dinero';
import { partirCodigos } from '@/features/exhibidores/codigos';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe, versionDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import { entregarAVendedora, regresarAKazero } from '@/server/piezas/custodia';
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
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const id = uuidDe(fd, 'id');
    const version = versionDe(fd);
    const datos = leer(fd);
    const { cambios } = await conDb((db) =>
      actualizarVendedor(db, {
        id,
        version,
        adminId,
        motivo: texto(fd, 'motivo'),
        activo: fd.get('activo') === 'on',
        ...datos,
      }),
    );
    if (cambios === 0) return 'Sin cambios.';
    revalidatePath(`/panel/vendedores/${id}`);
    revalidatePath('/panel/vendedores');
    // El nombre del vendedor aparece en clientes (vendedor habitual) y exhibidores.
    revalidatePath('/panel/clientes/[id]', 'page');
    revalidatePath('/panel/exhibidores');
    revalidatePath('/panel/exhibidores/[id]', 'page');
    return 'Cambios guardados.';
  });
}

const piezas = (n: number, participio: 'entregada' | 'regresada') =>
  n === 1 ? `1 pieza ${participio}.` : `${n} piezas ${participio}s.`;

/** Una pieza cambió de lugar: se refrescan la ficha de la vendedora, el inventario y las fichas de pieza. */
function revalidarCustodia(vendedorId: string) {
  revalidatePath(`/panel/vendedores/${vendedorId}`);
  revalidatePath('/panel/inventario');
  revalidatePath('/panel/inventario/[codigo]', 'page');
  revalidatePath('/panel/pedidos/nuevo');
}

export async function accionEntregarAVendedora(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const vendedorId = uuidDe(fd, 'vendedorId');
    const { entregadas } = await conDb((db) =>
      entregarAVendedora(db, { adminId, vendedorId, codigos: partirCodigos(texto(fd, 'codigos')) }),
    );
    revalidarCustodia(vendedorId);
    return piezas(entregadas, 'entregada');
  });
}

export async function accionRegresarAKazero(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const vendedorId = uuidDe(fd, 'vendedorId');
    const { regresadas } = await conDb((db) =>
      regresarAKazero(db, { adminId, vendedorId, codigos: partirCodigos(texto(fd, 'codigos')) }),
    );
    revalidarCustodia(vendedorId);
    return piezas(regresadas, 'regresada');
  });
}
