'use client';

import { Fragment, startTransition, useActionState, useEffect, useRef } from 'react';
import { Campo } from '@/features/ui/Campo';
import { ErroresCampo, useEnfocarPrimerInvalido } from '@/features/ui/errores-campo';
import type { EstadoAccion } from '@/features/ui/estado';
import { marcarIndiceSucio } from '@/search/eventos';
import { accionDeshacerCambio } from '../acciones';

/**
 * Siempre montado en la ficha (aunque no haya nada que deshacer): así su estado sobrevive a la
 * revalidación que lo deja sin destino, el mensaje de éxito se ve y el índice se marca sucio.
 */
export function FormDeshacerCambio({
  piezaId,
  version,
  destino,
}: {
  piezaId: string;
  version: number;
  destino: string | null;
}) {
  const [estado, despachar, pendiente] = useActionState<EstadoAccion, FormData>(accionDeshacerCambio, {});
  const form = useRef<HTMLFormElement>(null);
  useEnfocarPrimerInvalido(form, estado);
  useEffect(() => {
    if (estado.ok) marcarIndiceSucio();
  }, [estado]);

  return (
    <div className="flex flex-col gap-2">
      {estado.ok && (
        <p role="status" className="aviso-exito">
          {estado.ok}
        </p>
      )}
      {destino && (
        <form
          ref={form}
          className="tarjeta flex flex-col gap-3 p-4"
          aria-busy={pendiente}
          onSubmit={(e) => {
            e.preventDefault();
            if (pendiente) return;
            const datos = new FormData(e.currentTarget);
            startTransition(() => despachar(datos));
          }}
        >
          <ErroresCampo.Provider value={estado.campos ?? {}}>
            <Fragment key={version}>
              <input type="hidden" name="piezaId" value={piezaId} />
              <input type="hidden" name="version" value={version} />
              <p className="text-sm">{destino}</p>
              <Campo etiqueta="Motivo de la corrección" name="motivo" required maxLength={200} />
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name="confirmo"
                  value="si"
                  required
                  className="size-5 cursor-pointer"
                />
                Confirmo que quiero deshacer este cambio.
              </label>
            </Fragment>
          </ErroresCampo.Provider>
          {estado.error && (
            <p role="alert" className="aviso-error">
              {estado.campos ? 'Revisa los campos marcados.' : estado.error}
            </p>
          )}
          <button
            type="submit"
            disabled={pendiente}
            className="min-h-11 cursor-pointer self-start rounded-lg border border-secundario bg-white px-4 font-medium text-secundario enabled:hover:bg-secundario-suave disabled:opacity-60"
          >
            Deshacer último cambio
          </button>
        </form>
      )}
    </div>
  );
}
