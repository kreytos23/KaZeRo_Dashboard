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
          className="min-h-11 rounded-lg border border-stone-300 px-3 tracking-widest"
        />
      </label>
      <p className="text-xs text-stone-600">¿Sin tu teléfono? Escribe uno de tus códigos de recuperación.</p>
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
        Entrar
      </button>
    </form>
  );
}
