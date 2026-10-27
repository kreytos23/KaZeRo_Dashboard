'use client';

import { Fragment, useEffect, useRef } from 'react';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { AreaTexto, Campo, CampoCasilla, Selector } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { marcarIndiceSucio } from '@/search/eventos';
import { accionEditarPedido } from '../../acciones';

interface Props {
  pedidoId: string;
  folio: number;
  version: number;
  vendedorId: string;
  vendedores: { id: string; nombre: string }[];
  fecha: string;
  hoy: string;
  descuentoManual: string;
  descuentoMotivo: string;
  notas: string;
  piezas: { codigo: string; descripcion: string }[];
}

export function FormEditar(p: Props) {
  // El éxito redirige desde el servidor y este formulario se desmonta: ahí se avisa al buscador.
  const enviado = useRef(false);
  useEffect(
    () => () => {
      if (enviado.current) marcarIndiceSucio();
    },
    [],
  );
  return (
    <div className="max-w-2xl" onSubmit={() => (enviado.current = true)}>
      <FormAccion accion={accionEditarPedido} textoBoton="Guardar cambios">
        <Fragment key={p.version}>
          <input type="hidden" name="pedidoId" value={p.pedidoId} />
          <input type="hidden" name="folio" value={p.folio} />
          <input type="hidden" name="version" value={p.version} />
          <CampoKey />
          <Selector
            etiqueta="Vendedor"
            name="vendedorId"
            required
            defaultValue={p.vendedorId}
            opciones={p.vendedores.map((v) => ({ valor: v.id, texto: v.nombre }))}
          />
          <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={p.fecha} max={p.hoy} required />
          <Campo
            etiqueta="Descuento manual"
            name="descuentoManual"
            inputMode="decimal"
            defaultValue={p.descuentoManual}
            placeholder="0"
            autoComplete="off"
          />
          <Campo
            etiqueta="Motivo del descuento"
            name="descuentoMotivo"
            defaultValue={p.descuentoMotivo}
            maxLength={200}
            autoComplete="off"
          />
          <AreaTexto etiqueta="Notas" name="notas" rows={2} maxLength={500} defaultValue={p.notas} />
          <fieldset className="flex flex-col gap-1">
            <legend className="text-meta font-medium">Piezas del pedido</legend>
            {p.piezas.map((x) => (
              <CampoCasilla key={x.codigo} name="quitar" value={x.codigo}>
                Quitar <span className="font-mono">{x.codigo}</span>
                <span className="text-tinta-suave"> · {x.descripcion}</span>
              </CampoCasilla>
            ))}
          </fieldset>
          <AreaTexto
            etiqueta="Agregar piezas"
            name="agregar"
            rows={3}
            placeholder="Códigos separados por línea, espacio o coma"
          />
          <AreaTexto etiqueta="Motivo del cambio" name="motivo" rows={2} maxLength={200} />
          <p className="text-meta text-tinta-suave">El motivo es obligatorio si cambia el total.</p>
        </Fragment>
      </FormAccion>
    </div>
  );
}
