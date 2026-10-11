'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { marcarIndiceSucio } from '@/search/eventos';
import type { EstadoAccion } from './estado';

type Accion = (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>;

/**
 * Se despacha con onSubmit + startTransition en vez del prop `action`: React 19 reinicia el formulario
 * tras cualquier `action`, y con un error el usuario perdería lo que escribió.
 */
export function FormAccion({
  accion,
  textoBoton,
  children,
  limpiarAlGuardar = false,
  className = 'flex flex-col gap-3',
}: {
  accion: Accion;
  textoBoton: string;
  children: React.ReactNode;
  limpiarAlGuardar?: boolean;
  className?: string;
}) {
  const [estado, despachar, pendiente] = useActionState(accion, {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!estado.ok) return;
    marcarIndiceSucio();
    if (limpiarAlGuardar) form.current?.reset();
  }, [estado, limpiarAlGuardar]);

  return (
    <form
      ref={form}
      className={className}
      aria-busy={pendiente}
      onSubmit={(e) => {
        e.preventDefault();
        if (pendiente) return;
        const datos = new FormData(e.currentTarget);
        startTransition(() => despachar(datos));
      }}
    >
      {children}
      {estado.error && (
        <p role="alert" className="text-sm whitespace-pre-line text-red-700">
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="text-sm text-green-700">
          {estado.ok}
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 self-start rounded-lg bg-stone-900 px-4 font-medium text-white disabled:opacity-60"
      >
        {textoBoton}
      </button>
    </form>
  );
}
