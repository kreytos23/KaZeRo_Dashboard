'use client';

import { useActionState } from 'react';
import { BotonEnvio } from '@/features/ui/FormAccion';
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
          className="campo"
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
          className="campo"
        />
      </label>
      {estado.error && (
        <p role="alert" className="aviso-error">
          {estado.error}
        </p>
      )}
      <BotonEnvio textoBoton="Continuar" pendiente={pendiente} className="boton-primario" />
    </form>
  );
}
