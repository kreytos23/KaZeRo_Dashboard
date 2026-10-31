'use client';

import { Fragment } from 'react';
import { accionRetirarSaldo } from '@/app/panel/acciones';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { AreaTexto, Campo, CampoCasilla } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { formatoMXN, numericACentavos } from '@/domain/dinero';
import type { Titular } from '@/server/saldo-favor/servicio';

interface Props {
  /** La clienta o la vendedora dueña del saldo (va en un campo oculto con su nombre). */
  titular: Titular;
  /** numeric del saldo actual (prellena el monto). */
  saldo: string;
}

/**
 * Devolver en efectivo el saldo a favor (de una clienta o de una vendedora). El FormAccion sigue montado cuando el saldo llega a cero (solo cambian sus
 * hijos): así el aviso «Retiro registrado.» no desaparece con el formulario.
 */
export function FormRetiroSaldo({ titular, saldo }: Props) {
  const centavos = numericACentavos(saldo);
  const hay = centavos > 0;
  const [campo, id] = Object.entries(titular)[0]!;
  return (
    <FormAccion accion={accionRetirarSaldo} textoBoton="Devolver en efectivo" sinControles={!hay}>
      {hay && (
        // La llave cambia con el saldo: refresca el monto prellenado y regenera la llave de idempotencia.
        <Fragment key={saldo}>
          <input type="hidden" name={campo} value={id} />
          <CampoKey />
          <p className="text-meta text-tinta-suave">
            Disponible para devolver: {formatoMXN(centavos)}. Puedes devolver solo una parte.
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
