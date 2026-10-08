'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { conDb } from '@/db/client';
import { COOKIE_SESION } from '@/server/auth/cookies';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { cerrarSesion, cerrarTodas } from '@/server/auth/servicio';

export async function accionCerrarSesion() {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESION)?.value;
  if (token) await conDb((db) => cerrarSesion(db, token));
  jar.delete(COOKIE_SESION);
  redirect('/login');
}

export async function accionCerrarTodas() {
  const { adminId } = await requerirSesion();
  await conDb((db) => cerrarTodas(db, adminId));
  (await cookies()).delete(COOKIE_SESION);
  redirect('/login');
}
