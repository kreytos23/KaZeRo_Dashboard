'use client';

import { useActionState } from 'react';
import { accionVerificar, type EstadoForm } from '../acciones';

export function FormVerificar() {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(accionVerificar, {});
  return (
    <form action={accion} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Código de 6 dígitos
        <input
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          className="min-h-11 rounded-lg border border-borde-campo bg-white px-3 tracking-widest"
        />
      </label>
      <p className="text-xs text-tinta-suave">
        ¿Sin tu teléfono? Escribe uno de tus códigos de recuperación.
      </p>
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
        Entrar
      </button>
    </form>
  );
}
