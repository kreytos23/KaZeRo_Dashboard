'use server';

import { revalidatePath } from 'next/cache';
import { conDb } from '@/db/client';
import { agregarAdmin, regenerarTotp, type ResultadoEnrolamiento } from '@/server/auth/administradores';
import { qrComoDataUrl } from '@/server/auth/qr';
import { datosRed } from '@/server/auth/red';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { texto } from '@/server/acciones';
import { env } from '@/server/env';
import type { EstadoEnrolamiento } from './tipos';

async function presentar(r: ResultadoEnrolamiento): Promise<EstadoEnrolamiento> {
  if (!r.ok) return { error: r.error };
  return {
    enrolamiento: {
      email: r.email,
      secreto: r.secretoTotp,
      qr: await qrComoDataUrl(r.uriTotp),
      codigos: r.codigosRecuperacion,
    },
  };
}

export async function accionAgregarAdmin(_: EstadoEnrolamiento, fd: FormData): Promise<EstadoEnrolamiento> {
  const { adminId } = await requerirSesion();
  const red = await datosRed();
  const r = await conDb((db) =>
    agregarAdmin(
      db,
      {
        adminActualId: adminId,
        passwordActual: texto(fd, 'passwordActual'),
        email: texto(fd, 'email'),
        password: texto(fd, 'password'),
        confirmacion: texto(fd, 'confirmacion'),
        ...red,
      },
      env().KAZERO_TOTP_KEY,
    ),
  );
  // Solo se refresca la lista; el secreto vive en el estado del cliente y no se descarta.
  if (r.ok) revalidatePath('/panel/administradores');
  return presentar(r);
}

export async function accionRegenerarTotp(_: EstadoEnrolamiento, fd: FormData): Promise<EstadoEnrolamiento> {
  const { adminId, sesionId } = await requerirSesion();
  const red = await datosRed();
  const r = await conDb((db) =>
    regenerarTotp(
      db,
      { adminId, sesionActualId: sesionId, passwordActual: texto(fd, 'passwordActual'), ...red },
      env().KAZERO_TOTP_KEY,
    ),
  );
  // Si el bloqueo revocó esta sesión, requerirSesion() redirige a /login en vez de dejar un panel roto.
  if (!r.ok) await requerirSesion();
  return presentar(r);
}
