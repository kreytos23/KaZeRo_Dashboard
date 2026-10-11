import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { conDb } from '@/db/client';
import { COOKIE_SESION } from './cookies';
import { validarSesion } from './servicio';

/** Autorización real (el proxy solo mira que exista la cookie). Úsalo en layouts y en cada acción privada. */
export async function requerirSesion() {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  if (!token) redirect('/login');
  const s = await conDb((db) => validarSesion(db, token));
  if (!s) redirect('/login');
  return s;
}

/** Para Route Handlers: devuelve null en vez de redirigir (la ruta responde 401 JSON). */
export async function sesionDeApi() {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  if (!token) return null;
  return conDb((db) => validarSesion(db, token));
}
