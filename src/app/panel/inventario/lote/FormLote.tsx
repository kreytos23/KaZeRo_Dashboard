'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { AreaTexto } from '@/features/ui/Campo';
import { marcarIndiceSucio } from '@/search/eventos';
import { accionAltaLote } from '../acciones';
import type { EstadoLote } from '../tipos';

export function FormLote() {
  const [estado, despachar, pendiente] = useActionState<EstadoLote, FormData>(accionAltaLote, {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!estado.ok) return;
    marcarIndiceSucio();
    form.current?.reset();
  }, [estado]);

  return (
    <form
      ref={form}
      className="flex flex-col gap-3"
      aria-busy={pendiente}
      onSubmit={(e) => {
        e.preventDefault();
        if (pendiente) return;
        const datos = new FormData(e.currentTarget);
        startTransition(() => despachar(datos));
      }}
    >
      <AreaTexto etiqueta="Filas pegadas desde Excel" name="filas" rows={14} required maxLength={200000} />
      {estado.error && (
        <div role="alert" className="aviso-error">
          <p>{estado.error}</p>
          {estado.lineas && (
            <ul className="mt-1 list-disc pl-5">
              {estado.lineas.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {estado.ok && (
        <p role="status" className="aviso-exito">
          {estado.ok}
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 self-start rounded-lg bg-primario px-4 font-medium text-white enabled:hover:bg-primario-fuerte disabled:opacity-60"
      >
        Dar de alta el lote
      </button>
    </form>
  );
}
