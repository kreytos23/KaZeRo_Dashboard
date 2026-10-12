'use client';

import { Fragment, startTransition, useActionState, useEffect, useId, useRef } from 'react';
import { Campo } from '@/features/ui/Campo';
import { ErroresCampo, useEnfocarPrimerInvalido } from '@/features/ui/errores-campo';
import type { EstadoAccion } from '@/features/ui/estado';
import { useHidratado } from '@/features/ui/hidratado';
import { marcarIndiceSucio } from '@/search/eventos';
import { accionDeshacerCambio } from '../acciones';

/**
 * Siempre montado en el movimiento más reciente (aunque no haya nada que deshacer): su estado sobrevive a la
 * revalidación que lo deja sin destino, el aviso de éxito sigue en pantalla y el índice se marca sucio.
 * Tras el éxito el formulario desaparece: el foco pasa a la región de estado (siempre montada y vacía al
 * inicio, para que el lector de pantalla anuncie su contenido).
 */
export function FormDeshacerCambio({
  piezaId,
  version,
  titulo,
  destino,
}: {
  piezaId: string;
  version: number;
  titulo: string;
  destino: string | null;
}) {
  const [estado, despachar, pendiente] = useActionState<EstadoAccion, FormData>(accionDeshacerCambio, {});
  const form = useRef<HTMLFormElement>(null);
  const aviso = useRef<HTMLDivElement>(null);
  const idConfirmo = useId();
  const hidratado = useHidratado();
  useEnfocarPrimerInvalido(form, estado);
  useEffect(() => {
    if (!estado.ok) return;
    marcarIndiceSucio();
    aviso.current?.focus();
  }, [estado]);
  const errorConfirmo = estado.campos?.confirmo;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div ref={aviso} role="status" tabIndex={-1} className={estado.ok ? 'aviso-exito' : undefined}>
        {estado.ok}
      </div>
      {destino && (
        <form
          ref={form}
          method="post"
          data-hidratado={hidratado ? 'si' : 'no'}
          aria-labelledby={`${idConfirmo}-titulo`}
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
              <p id={`${idConfirmo}-titulo`} className="font-semibold">
                {titulo}
              </p>
              <p>{destino}</p>
              <Campo
                etiqueta="Motivo de la corrección (obligatorio)"
                name="motivo"
                required
                maxLength={200}
              />
              <div className="flex flex-col gap-1">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
                  <input
                    id={idConfirmo}
                    type="checkbox"
                    name="confirmo"
                    value="si"
                    required
                    aria-invalid={errorConfirmo ? true : undefined}
                    aria-describedby={errorConfirmo ? `${idConfirmo}-error` : undefined}
                    className="size-5 cursor-pointer"
                  />
                  Confirmo que quiero deshacer este cambio.
                </label>
                {errorConfirmo && (
                  <span id={`${idConfirmo}-error`} className="text-error">
                    {errorConfirmo}
                  </span>
                )}
              </div>
            </Fragment>
          </ErroresCampo.Provider>
          {estado.error && (
            <p role="alert" className="aviso-error">
              {estado.campos ? 'Revisa los campos marcados.' : estado.error}
            </p>
          )}
          <button
            type="submit"
            disabled={pendiente || !hidratado}
            className="min-h-11 cursor-pointer self-start rounded-lg border border-secundario bg-white px-4 font-medium text-secundario enabled:hover:bg-secundario-suave disabled:opacity-60"
          >
            Deshacer este cambio
          </button>
        </form>
      )}
    </div>
  );
}
