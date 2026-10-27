'use client';

import { Fragment } from 'react';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { AreaTexto, Campo, CampoCasilla } from '@/features/ui/Campo';
import { Desplegable } from '@/features/ui/Desplegable';
import { FormAccion } from '@/features/ui/FormAccion';
import { accionDevolverPieza } from '../acciones';

interface Props {
  pedidoId: string;
  folio: number;
  itemId: string;
  codigo: string;
  /** Lo que pagó la clienta por esta línea, ya calculado (precio final menos su parte del descuento manual). */
  montoTexto: string;
  hoy: string;
  fechaPedido: string;
}

/** «Devolver por defecto» de una línea de un pedido liquidado: el monto pasa a saldo a favor de la clienta. */
export function FormDevolver({ pedidoId, folio, itemId, codigo, montoTexto, hoy, fechaPedido }: Props) {
  return (
    <Desplegable etiqueta="Devolver por defecto">
      <FormAccion accion={accionDevolverPieza} textoBoton={`Devolver ${codigo}`}>
        <Fragment>
          <input type="hidden" name="pedidoId" value={pedidoId} />
          <input type="hidden" name="folio" value={folio} />
          <input type="hidden" name="itemId" value={itemId} />
          <CampoKey />
          <AreaTexto etiqueta="Motivo de la devolución" name="motivo" rows={2} maxLength={200} required />
          <Campo
            etiqueta="Fecha"
            name="fecha"
            type="date"
            defaultValue={hoy}
            min={fechaPedido}
            max={hoy}
            required
          />
          <p className="aviso-atencion">
            Pasarán {montoTexto} a saldo a favor de la clienta y {codigo} quedará en «Defecto». Esta acción no
            se puede deshacer.
          </p>
          <CampoCasilla name="confirmo" required>
            Confirmo la devolución de {codigo}
          </CampoCasilla>
        </Fragment>
      </FormAccion>
    </Desplegable>
  );
}
