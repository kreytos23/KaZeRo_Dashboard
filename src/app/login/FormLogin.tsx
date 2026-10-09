'use client';

import { useActionState } from 'react';
import { accionLogin, type EstadoForm } from './acciones';

export function FormLogin() {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(accionLogin, {});
  return (
    <form action={accion} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Correo
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="min-h-11 rounded-lg border border-stone-300 px-3"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Contraseña
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-11 rounded-lg border border-stone-300 px-3"
        />
      </label>
      {estado.error && (
        <p role="alert" className="text-sm text-red-700">
          {estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 rounded-lg bg-stone-900 font-medium text-white disabled:opacity-60"
      >
        Continuar
      </button>
    </form>
  );
}
