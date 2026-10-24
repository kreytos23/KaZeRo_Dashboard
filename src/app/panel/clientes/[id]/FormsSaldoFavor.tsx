'use client';

import { Fragment } from 'react';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { AreaTexto, Campo } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { accionRetirarSaldoFavor } from '../acciones';

interface Props {
  clienteId: string;
  /** numeric del saldo actual (prellena el monto). */
  saldo: string;
  saldoTexto: string;
  hayInicial: boolean;
}

/**
 * Devolver en efectivo el saldo a favor. El FormAccion sigue montado cuando el saldo llega a cero (solo cambian sus
 * hijos): así el aviso «Retiro registrado.» no desaparece con el formulario.
 */
export function FormsSaldoFavor({ clienteId, saldo, saldoTexto, hayInicial }: Props) {
  const hay = hayInicial;
  return (
    <FormAccion accion={accionRetirarSaldoFavor} textoBoton="Devolver en efectivo" sinControles={!hay}>
      {hay && (
        // La llave cambia con el saldo: refresca el monto prellenado y regenera la llave de idempotencia.
        <Fragment key={saldo}>
          <input type="hidden" name="clienteId" value={clienteId} />
          <CampoKey />
          <p className="text-sm text-tinta-suave">
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
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="confirmo" required /> Confirmo que entregué el efectivo
          </label>
        </Fragment>
      )}
    </FormAccion>
  );
}
