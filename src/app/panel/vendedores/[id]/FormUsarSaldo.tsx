'use client';

import { Fragment, useState } from 'react';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { formatoFolio } from '@/domain/pedidos';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { Campo, Selector } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { accionRegistrarPago } from '../../pedidos/acciones';
import type { PedidoAbierto } from './FormPagoAgrupado';

interface Props {
  saldo: string;
  pedidos: PedidoAbierto[];
  hoy: string;
}

/** Cuánto alcanza: lo menor entre el saldo a favor y lo que debe el pedido elegido. */
const alcanza = (saldo: string, p: PedidoAbierto | undefined) =>
  centavosANumeric(Math.min(numericACentavos(saldo), p?.saldoCentavos ?? 0));

function Campos({ saldo, pedidos, hoy }: Props) {
  const [id, setId] = useState(pedidos[0]!.id);
  const elegido = pedidos.find((p) => p.id === id);
  const [monto, setMonto] = useState(alcanza(saldo, pedidos[0]));
  return (
    <>
      <CampoKey />
      <input type="hidden" name="metodo" value="saldo_favor" />
      <input type="hidden" name="pagador" value="vendedor" />
      <input type="hidden" name="folio" value={elegido?.folio ?? ''} />
      <Selector
        etiqueta="Pedido"
        name="pedidoId"
        required
        value={id}
        onChange={(v) => {
          setId(v);
          setMonto(
            alcanza(
              saldo,
              pedidos.find((p) => p.id === v),
            ),
          );
        }}
        opciones={pedidos.map((p) => ({
          valor: p.id,
          texto: `${formatoFolio(p.folio)} · ${p.clienteNombre} · debe ${formatoMXN(p.saldoCentavos)}`,
        }))}
      />
      <Campo
        etiqueta="Monto a usar"
        name="monto"
        inputMode="decimal"
        value={monto}
        onChange={(e) => setMonto(e.target.value)}
        required
        autoComplete="off"
      />
      <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} required />
    </>
  );
}

/** Usar el saldo a favor de la vendedora para pagar uno de sus pedidos (P-2). Sin pedidos abiertos no hay nada que usar. */
export function FormUsarSaldo(p: Props) {
  const hay = p.pedidos.length > 0 && numericACentavos(p.saldo) > 0;
  const marca = `${p.saldo}|${p.pedidos.map((x) => `${x.id}:${x.saldoCentavos}`).join(',')}`;
  return (
    <FormAccion accion={accionRegistrarPago} textoBoton="Usar en el pedido" sinControles={!hay}>
      {hay && (
        <Fragment key={marca}>
          <Campos {...p} />
        </Fragment>
      )}
    </FormAccion>
  );
}
