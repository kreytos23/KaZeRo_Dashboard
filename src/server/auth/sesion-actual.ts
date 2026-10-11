import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { conDbLectura } from '@/db/client';
import { COOKIE_SESION } from './cookies';
import { validarSesion } from './servicio';

/**
 * Una validación por request y por token: layout y página llaman `requerirSesion()` cada uno, pero
 * React `cache()` comparte el resultado mientras dura el render. Fuera de un render (Server Actions)
 * `cache()` no memoiza y cada llamada valida de nuevo, así que una acción nunca ve una sesión vieja.
 * `validarSesion` solo "toca" `ultimo_uso_at` (idempotente), por eso puede ir por la lectura con reintento.
 */
const validarToken = cache((token: string) => conDbLectura((db) => validarSesion(db, token)));

/** Autorización real (el proxy solo mira que exista la cookie). Úsalo en layouts y en cada acción privada. */
export async function requerirSesion() {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  if (!token) redirect('/login');
  const s = await validarToken(token);
  if (!s) redirect('/login');
  return s;
}

/** Para Route Handlers: devuelve null en vez de redirigir (la ruta responde 401 JSON). Sin caché. */
export async function sesionDeApi() {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  if (!token) return null;
  return conDbLectura((db) => validarSesion(db, token));
}
