'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { AreaTexto } from '@/features/ui/Campo';
import { BotonEnvio } from '@/features/ui/FormAccion';
import { useHidratado } from '@/features/ui/hidratado';
import { marcarIndiceSucio } from '@/search/eventos';
import { accionAltaLote } from '../acciones';
import type { EstadoLote } from '../tipos';

export function FormLote() {
  const [estado, despachar, pendiente] = useActionState<EstadoLote, FormData>(accionAltaLote, {});
  const form = useRef<HTMLFormElement>(null);
  const hidratado = useHidratado();

  useEffect(() => {
    if (!estado.ok) return;
    marcarIndiceSucio();
    form.current?.reset();
  }, [estado]);

  return (
    <form
      ref={form}
      method="post"
      data-hidratado={hidratado ? 'si' : 'no'}
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
      {/* Siempre montado: una región que nace con texto no se anuncia. */}
      <p role="status" className={estado.ok ? 'aviso-exito' : undefined}>
        {estado.ok}
      </p>
      <BotonEnvio textoBoton="Dar de alta el lote" pendiente={pendiente} hidratado={hidratado} />
    </form>
  );
}
