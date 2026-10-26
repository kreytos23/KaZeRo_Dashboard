'use client';

import { useActionState } from 'react';
import { BotonEnvio } from '@/features/ui/FormAccion';
import { accionVerificar, type EstadoForm } from '../acciones';

export function FormVerificar() {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(accionVerificar, {});
  return (
    <form action={accion} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-meta font-medium">
        Código de 6 dígitos
        <input
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          className="campo tracking-widest"
        />
      </label>
      <p className="text-meta text-tinta-suave">
        ¿Sin tu teléfono? Escribe uno de tus códigos de recuperación.
      </p>
      {estado.error && (
        <p role="alert" className="aviso-error">
          {estado.error}
        </p>
      )}
      <BotonEnvio textoBoton="Entrar" pendiente={pendiente} className="boton-primario" />
    </form>
  );
}
