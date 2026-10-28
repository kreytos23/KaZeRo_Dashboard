'use server';

import { revalidatePath } from 'next/cache';
import { conDb } from '@/db/client';
import { formatoFolio } from '@/domain/pedidos';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import { anularPago } from '@/server/pagos/anular';
import { revalidarPedidos } from '../pedidos/revalidar';

/** P-5: deshacer un pago completo. Mueve dinero y reabre pedidos: pide motivo y la casilla de confirmación. */
export async function accionAnularPago(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    // Acción que no se deshace: la casilla `required` no basta, un POST directo la saltaría.
    if (texto(fd, 'confirmo') !== 'on')
      throw new ErrorNegocio('confirmacion', 'Marca la casilla para confirmar que quieres deshacer el pago.');
    const pagoId = uuidDe(fd, 'pagoId');
    const { reabiertos } = await conDb((db) =>
      anularPago(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        pagoId,
        motivo: texto(fd, 'motivo').slice(0, 400),
      }),
    );
    revalidatePath(`/panel/pagos/${pagoId}`);
    revalidarPedidos();
    return reabiertos.length
      ? `Pago deshecho. Se reabrieron ${reabiertos.map(formatoFolio).join(', ')}.`
      : 'Pago deshecho.';
  });
}
