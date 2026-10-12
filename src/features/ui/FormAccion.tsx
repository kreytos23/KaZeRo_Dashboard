'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { marcarIndiceSucio } from '@/search/eventos';
import { useHidratado } from './hidratado';
import { ErroresCampo, useEnfocarPrimerInvalido } from './errores-campo';
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
  sinControles = false,
}: {
  accion: Accion;
  textoBoton: string;
  children: React.ReactNode;
  limpiarAlGuardar?: boolean;
  className?: string;
  /** Mantiene montado el aviso (role=status) pero sin botón: p. ej. tras quitar la foto ya no hay nada que quitar. */
  sinControles?: boolean;
}) {
  const [estado, despachar, pendiente] = useActionState(accion, {});
  const form = useRef<HTMLFormElement>(null);
  const hidratado = useHidratado();

  useEffect(() => {
    if (!estado.ok) return;
    marcarIndiceSucio();
    if (limpiarAlGuardar) form.current?.reset();
  }, [estado, limpiarAlGuardar]);

  useEnfocarPrimerInvalido(form, estado);

  return (
    <form
      ref={form}
      method="post"
      data-hidratado={hidratado ? 'si' : 'no'}
      className={className}
      aria-busy={pendiente}
      onSubmit={(e) => {
        e.preventDefault();
        if (pendiente) return;
        const datos = new FormData(e.currentTarget);
        startTransition(() => despachar(datos));
      }}
    >
      <ErroresCampo.Provider value={estado.campos ?? {}}>{children}</ErroresCampo.Provider>
      {estado.error && (
        <p role="alert" className="aviso-error whitespace-pre-line">
          {/* Con errores por campo, el detalle lo anuncia cada campo (aria-describedby): aquí solo un resumen. */}
          {estado.campos ? 'Revisa los campos marcados.' : estado.error}
        </p>
      )}
      {/* Siempre montado: una región que nace con texto no se anuncia. */}
      <p role="status" className={estado.ok ? 'aviso-exito' : undefined}>
        {estado.ok}
      </p>
      {!sinControles && (
        <button
          type="submit"
          disabled={pendiente || !hidratado}
          className="min-h-11 self-start rounded-lg bg-primario px-4 font-medium text-white enabled:hover:bg-primario-fuerte disabled:opacity-60"
        >
          {textoBoton}
        </button>
      )}
    </form>
  );
}
