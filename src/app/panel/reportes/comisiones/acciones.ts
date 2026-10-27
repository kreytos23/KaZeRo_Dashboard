'use server';

import { revalidatePath } from 'next/cache';
import { conDb } from '@/db/client';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import { anularPagoComision, cerrarMesComisiones, registrarPagoComision } from '@/server/comisiones/servicio';

function refrescar() {
  revalidatePath('/panel/reportes/comisiones');
  revalidatePath('/panel/vendedores/[id]', 'page');
}

export async function accionCerrarMes(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    // Irreversible: la casilla `required` no basta, un POST directo la saltaría.
    if (texto(fd, 'confirmo') !== 'on')
      throw new ErrorNegocio('confirmacion', 'Marca la casilla para confirmar el cierre.');
    // Nunca se pasa `hoy`: el servicio usa la fecha real del servidor.
    const r = await conDb((db) =>
      cerrarMesComisiones(db, { key: uuidDe(fd, 'key'), adminId, mes: texto(fd, 'mes').slice(0, 10) }),
    );
    refrescar();
    return `Mes cerrado: ${r.numPedidos} ${r.numPedidos === 1 ? 'pedido' : 'pedidos'} congelados.`;
  });
}

export async function accionRegistrarPagoComision(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    await conDb((db) =>
      registrarPagoComision(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        corteId: uuidDe(fd, 'corteId'),
        vendedorId: uuidDe(fd, 'vendedorId'),
        fecha: texto(fd, 'fecha').slice(0, 20),
        metodo: texto(fd, 'metodo'), // el servicio valida contra sus métodos
        nota: texto(fd, 'nota').slice(0, 400),
      }),
    );
    refrescar();
    return 'Pago registrado.';
  });
}

export async function accionAnularPagoComision(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    await conDb((db) =>
      anularPagoComision(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        pagoId: uuidDe(fd, 'pagoId'),
        motivo: texto(fd, 'motivo').slice(0, 400),
      }),
    );
    refrescar();
    return 'Pago deshecho.';
  });
}
