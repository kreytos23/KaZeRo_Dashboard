'use client';

import { useActionState } from 'react';
import { accionLogin, type EstadoForm } from './acciones';

export function FormLogin() {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(accionLogin, {});
  return (
    <form action={accion} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-meta font-medium">
        Correo
        <input
          id="login-correo"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="min-h-11 rounded-lg border border-borde-campo bg-white px-3"
        />
      </label>
      <label className="flex flex-col gap-1 text-meta font-medium">
        Contraseña
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-11 rounded-lg border border-borde-campo bg-white px-3"
        />
      </label>
      {estado.error && (
        <p role="alert" className="aviso-error">
          {estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 rounded-lg bg-primario font-medium text-white enabled:hover:bg-primario-fuerte disabled:opacity-60"
      >
        Continuar
      </button>
    </form>
  );
}
