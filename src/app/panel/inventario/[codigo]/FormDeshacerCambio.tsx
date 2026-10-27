'use client';

import { Fragment, startTransition, useActionState, useEffect, useId, useRef } from 'react';
import { Campo, CampoCasilla } from '@/features/ui/Campo';
import { ErroresCampo, useEnfocarPrimerInvalido } from '@/features/ui/errores-campo';
import type { EstadoAccion } from '@/features/ui/estado';
import { BotonEnvio } from '@/features/ui/FormAccion';
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
              <CampoCasilla name="confirmo" value="si" required>
                <span className="font-medium">Confirmo que quiero deshacer este cambio.</span>
              </CampoCasilla>
            </Fragment>
          </ErroresCampo.Provider>
          {estado.error && (
            <p role="alert" className="aviso-error">
              {estado.campos ? 'Revisa los campos marcados.' : estado.error}
            </p>
          )}
          <BotonEnvio
            textoBoton="Deshacer este cambio"
            pendiente={pendiente}
            hidratado={hidratado}
            className="boton-secundario self-start"
          />
        </form>
      )}
    </div>
  );
}
