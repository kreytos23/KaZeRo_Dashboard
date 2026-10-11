'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { conDb } from '@/db/client';
import { COOKIE_SESION, opcionesBorrado } from '@/server/auth/cookies';
import { datosRed } from '@/server/auth/red';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { cerrarSesion, cerrarTodas } from '@/server/auth/servicio';

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
