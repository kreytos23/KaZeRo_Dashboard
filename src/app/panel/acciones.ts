'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { conDb } from '@/db/client';
import { pesosACentavos } from '@/domain/dinero';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe } from '@/server/acciones';
import { COOKIE_SESION, opcionesBorrado } from '@/server/auth/cookies';
import { datosRed } from '@/server/auth/red';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { cerrarSesion, cerrarTodas } from '@/server/auth/servicio';
import { ErrorNegocio } from '@/server/errores';
import { retirarSaldoFavor, type Titular } from '@/server/saldo-favor/servicio';

export async function accionCerrarSesion() {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESION)?.value;
  const red = await datosRed();
  if (token) await conDb((db) => cerrarSesion(db, token, new Date(), red));
  jar.set(COOKIE_SESION, '', opcionesBorrado());
  redirect('/login');
}

export async function accionCerrarTodas() {
  const { adminId } = await requerirSesion();
  const red = await datosRed();
  await conDb((db) => cerrarTodas(db, adminId, new Date(), red));
  (await cookies()).set(COOKIE_SESION, '', opcionesBorrado());
  redirect('/login');
}

/** D-21 / P-2: el titular (campo `clienteId` o `vendedorId`) retira en efectivo su saldo a favor. */
export async function accionRetirarSaldo(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const titular: Titular = fd.has('clienteId')
      ? { clienteId: uuidDe(fd, 'clienteId') }
      : { vendedorId: uuidDe(fd, 'vendedorId') };
    // Dinero que sale de la caja: la casilla `required` no basta, un POST directo la saltaría.
    if (texto(fd, 'confirmo') !== 'on')
      throw new ErrorNegocio('confirmacion', 'Marca la casilla para confirmar que entregaste el efectivo.');
    const monto = pesosACentavos(texto(fd, 'monto').trim());
    if (monto === null || monto <= 0)
      throw new ErrorNegocio('monto_invalido', 'Escribe un monto válido, por ejemplo 149 o 149.50.', 'monto');
    await conDb((db) =>
      retirarSaldoFavor(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        titular,
        montoCentavos: monto,
        nota: texto(fd, 'nota').slice(0, 400),
      }),
    );
    if ('clienteId' in titular) {
      revalidatePath(`/panel/clientes/${titular.clienteId}`);
      revalidatePath('/panel/clientes');
    } else revalidatePath(`/panel/vendedores/${titular.vendedorId}`);
    return 'Retiro registrado.';
  });
}
