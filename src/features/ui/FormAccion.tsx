'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { marcarIndiceSucio } from '@/search/eventos';
import { useHidratado } from './hidratado';
import { ErroresCampo, useEnfocarPrimerInvalido } from './errores-campo';
import type { EstadoAccion } from './estado';

type Accion = (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>;

/**
 * Botón de envío con «Guardando…» y un indicador discreto mientras la acción está en curso. Lo comparten
 * todos los formularios para que el aviso de que algo se está guardando se vea igual en toda la app.
 */
export function BotonEnvio({
  textoBoton,
  pendiente,
  hidratado = true,
  deshabilitado = false,
  className = 'boton-primario self-start',
  name,
  value,
}: {
  textoBoton: string;
  /** Se está guardando: muestra «Guardando…» con el indicador. */
  pendiente: boolean;
  /** Hasta hidratar, el botón no envía (un envío nativo pondría los campos en la URL). */
  hidratado?: boolean;
  /** Apagado sin indicador (p. ej. el otro botón de envío mientras uno guarda). */
  deshabilitado?: boolean;
  className?: string;
  name?: string;
  value?: string;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pendiente || deshabilitado || !hidratado}
      className={className}
    >
      {pendiente ? (
        <>
          <span aria-hidden="true" className="indicador-carga" />
          Guardando…
        </>
      ) : (
        textoBoton
      )}
    </button>
  );
}

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
      {/* Siempre montado: una región que nace con texto no se anuncia. Al guardar, el aviso dibuja su palomita. */}
      <p role="status" className={estado.ok ? 'aviso-exito' : undefined}>
        {estado.ok}
      </p>
      {!sinControles && <BotonEnvio textoBoton={textoBoton} pendiente={pendiente} hidratado={hidratado} />}
    </form>
  );
}
