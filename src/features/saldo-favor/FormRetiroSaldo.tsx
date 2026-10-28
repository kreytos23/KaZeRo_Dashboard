'use client';

import { Fragment } from 'react';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { AreaTexto, Campo, CampoCasilla } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import type { EstadoAccion } from '@/features/ui/estado';

interface Props {
  /** Server Action del retiro: la de la clienta o la de la vendedora (misma forma de formulario). */
  accion: (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>;
  /** Nombre del campo oculto con el titular: `clienteId` o `vendedorId`. */
  campoTitular: 'clienteId' | 'vendedorId';
  titularId: string;
  /** numeric del saldo actual (prellena el monto). */
  saldo: string;
  saldoTexto: string;
  hayInicial: boolean;
}

/**
 * Devolver en efectivo el saldo a favor (de una clienta o de una vendedora). El FormAccion sigue montado cuando el saldo llega a cero (solo cambian sus
 * hijos): así el aviso «Retiro registrado.» no desaparece con el formulario.
 */
export function FormRetiroSaldo({ accion, campoTitular, titularId, saldo, saldoTexto, hayInicial }: Props) {
  const hay = hayInicial;
  return (
    <FormAccion accion={accion} textoBoton="Devolver en efectivo" sinControles={!hay}>
      {hay && (
        // La llave cambia con el saldo: refresca el monto prellenado y regenera la llave de idempotencia.
        <Fragment key={saldo}>
          <input type="hidden" name={campoTitular} value={titularId} />
          <CampoKey />
          <p className="text-meta text-tinta-suave">
            Disponible para devolver: {saldoTexto}. Puedes devolver solo una parte.
          </p>
          <Campo
            etiqueta="Monto a devolver"
            name="monto"
            inputMode="decimal"
            defaultValue={saldo}
            required
            autoComplete="off"
          />
          <AreaTexto etiqueta="Nota del retiro" name="nota" rows={2} maxLength={200} required />
          <CampoCasilla name="confirmo" required>
            Confirmo que entregué el efectivo
          </CampoCasilla>
        </Fragment>
      )}
    </FormAccion>
  );
}
