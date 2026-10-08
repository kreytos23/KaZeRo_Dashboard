'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { conDb } from '@/db/client';
import { COOKIE_PRE, COOKIE_SESION, opcionesBorrado, opcionesCookie } from '@/server/auth/cookies';
import { datosRed } from '@/server/auth/red';
import { POLITICA, iniciarLogin, verificarSegundoFactor } from '@/server/auth/servicio';
import { env } from '@/server/env';

export type EstadoForm = { error?: string };

const esquemaLogin = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });
const esquemaCodigo = z.object({ codigo: z.string().trim().min(6).max(20) });

const mensajeBloqueo = (m?: number) =>
  `Demasiados intentos. Intenta de nuevo en ${m ?? POLITICA.ventanaMin} min.`;

export async function accionLogin(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const p = esquemaLogin.safeParse({ email: fd.get('email'), password: fd.get('password') });
  if (!p.success) return { error: 'Escribe tu correo y contraseña.' };
  const r = await conDb(async (db) => iniciarLogin(db, { ...p.data, ...(await datosRed()) }));
  if (!r.ok)
    return {
      error:
        r.motivo === 'bloqueado' ? mensajeBloqueo(r.minutosRestantes) : 'Correo o contraseña incorrectos.',
    };
  (await cookies()).set(COOKIE_PRE, r.preToken, opcionesCookie(POLITICA.preMfaMin * 60));
  redirect('/login/verificar');
}

export async function accionVerificar(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const jar = await cookies();
  const preToken = jar.get(COOKIE_PRE)?.value;
  if (!preToken) redirect('/login');
  const p = esquemaCodigo.safeParse({ codigo: fd.get('codigo') });
  if (!p.success) return { error: 'Escribe el código de tu app autenticadora o un código de recuperación.' };
  const r = await conDb(async (db) =>
    verificarSegundoFactor(
      db,
      { preToken, codigo: p.data.codigo, ...(await datosRed()) },
      env().KAZERO_TOTP_KEY,
    ),
  );
  if (!r.ok) {
    if (r.motivo === 'sesion') redirect('/login');
    return {
      error: r.motivo === 'bloqueado' ? mensajeBloqueo(r.minutosRestantes) : 'Código incorrecto o ya usado.',
    };
  }
  jar.set(COOKIE_PRE, '', opcionesBorrado());
  jar.set(COOKIE_SESION, r.token, opcionesCookie(POLITICA.sesionDias * 24 * 60 * 60));
  redirect('/panel');
}
