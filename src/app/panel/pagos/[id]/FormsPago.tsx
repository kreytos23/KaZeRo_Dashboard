'use client';

import { Fragment, useState } from 'react';
import { CampoCaptura } from '@/features/pagos/CampoCaptura';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { AreaTexto, CampoCasilla } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { accionAgregarComprobante } from '../../pedidos/acciones';
import { accionAnularPago } from '../acciones';

/** P-3: agrega la captura a un pago que no la tiene. El formulario sigue montado al guardar para conservar el aviso. */
export function FormAgregarComprobante({ pagoId, activo }: { pagoId: string; activo: boolean }) {
  const [hay, setHay] = useState(false);
  return (
    <FormAccion accion={accionAgregarComprobante} textoBoton="Guardar captura" sinControles={!activo || !hay}>
      {activo && (
        <Fragment>
          <input type="hidden" name="pagoId" value={pagoId} />
          <CampoKey />
          <CampoCaptura etiqueta="Agregar captura" onCambio={setHay} />
        </Fragment>
      )}
    </FormAccion>
  );
}

/**
 * P-5: deshacer el pago completo. Vive en el panel «Deshacer pago» de «Más acciones»; se mantiene montado aunque el
 * pago ya esté anulado, para que el aviso «Pago deshecho.» no desaparezca con el formulario.
 */
export function FormDeshacerPago({
  pagoId,
  montoTexto,
  vigente,
  pedidos,
}: {
  pagoId: string;
  montoTexto: string;
  vigente: boolean;
  /** Folios de los pedidos a los que se aplicó (texto ya armado, p. ej. «KZR-3, KZR-8»). */
  pedidos: string;
}) {
  return (
    <FormAccion accion={accionAnularPago} textoBoton="Deshacer pago" sinControles={!vigente}>
      {vigente && (
        <Fragment>
          <input type="hidden" name="pagoId" value={pagoId} />
          <CampoKey />
          <p className="aviso-atencion">
            Se deshace el pago de {montoTexto}
            {pedidos ? ` aplicado a ${pedidos}` : ''}. Los pedidos que queden con saldo se reabren y sus
            piezas vuelven a apartadas. El pago queda registrado como anulado, no se borra.
          </p>
          <AreaTexto etiqueta="Motivo" name="motivo" rows={2} maxLength={200} required />
          <CampoCasilla name="confirmo" required>
            Entiendo que se deshace el pago completo
          </CampoCasilla>
        </Fragment>
      )}
    </FormAccion>
  );
}
