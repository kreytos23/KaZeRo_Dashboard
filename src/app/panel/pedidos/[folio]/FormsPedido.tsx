'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { AreaTexto, Campo, Selector } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { accionCancelarPedido, accionRegistrarPago } from '../acciones';
import { ETIQUETA_METODO } from '../etiquetas';

interface Props {
  pedidoId: string;
  folio: number;
  version: number;
  /** Solo un pedido abierto muestra campos; al liquidarse o cancelarse se conserva el aviso de estado. */
  abierto: boolean;
  clienteNombre: string;
  vendedorNombre: string;
  /** numeric del saldo (para prellenar) y su texto en pesos. */
  saldo: string;
  saldoTexto: string;
  pagadoTexto: string;
  hayPagado: boolean;
  piezas: number;
  hoy: string;
}

/**
 * Los FormAccion siguen montados cuando el pedido deja de estar abierto (solo cambian sus hijos): así el aviso
 * "Pago registrado." / "Pedido cancelado." no desaparece con el formulario (región role=status siempre montada).
 */
export function FormsPedido(p: Props) {
  // La llave del Fragment cambia con la versión y con lo pagado: refresca valores y regenera la llave de idempotencia.
  const marca = `${p.version}-${p.saldo}`;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="registrar-pago" className="flex flex-col gap-2">
        {p.abierto && (
          <h2 id="registrar-pago" className="text-lg font-semibold">
            Registrar pago
          </h2>
        )}
        <FormAccion accion={accionRegistrarPago} textoBoton="Registrar pago" sinControles={!p.abierto}>
          {p.abierto && (
            <Fragment key={marca}>
              <input type="hidden" name="pedidoId" value={p.pedidoId} />
              <input type="hidden" name="folio" value={p.folio} />
              <CampoKey />
              <p className="text-sm text-tinta-suave">Saldo pendiente: {p.saldoTexto}</p>
              <Campo
                etiqueta="Monto"
                name="monto"
                inputMode="decimal"
                defaultValue={p.saldo}
                required
                autoComplete="off"
              />
              <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={p.hoy} max={p.hoy} required />
              <Selector
                etiqueta="Método"
                name="metodo"
                required
                defaultValue="transferencia"
                opciones={Object.entries(ETIQUETA_METODO).map(([valor, texto]) => ({ valor, texto }))}
              />
              <Selector
                etiqueta="Paga"
                name="pagador"
                defaultValue="cliente"
                opciones={[
                  { valor: 'cliente', texto: `${p.clienteNombre} (cliente)` },
                  { valor: 'vendedor', texto: `${p.vendedorNombre} (vendedor)` },
                ]}
              />
              <Campo etiqueta="Nota" name="nota" maxLength={200} autoComplete="off" />
            </Fragment>
          )}
        </FormAccion>
      </section>

      {p.abierto && (
        <Link
          href={`/panel/pedidos/${p.folio}/editar`}
          className="flex min-h-11 items-center self-start rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave"
        >
          Editar pedido
        </Link>
      )}

      <section aria-labelledby="cancelar-pedido" className="flex flex-col gap-2">
        {p.abierto && (
          <h2 id="cancelar-pedido" className="text-lg font-semibold">
            Cancelar pedido
          </h2>
        )}
        <FormAccion accion={accionCancelarPedido} textoBoton="Cancelar pedido" sinControles={!p.abierto}>
          {p.abierto && (
            <Fragment key={marca}>
              <input type="hidden" name="pedidoId" value={p.pedidoId} />
              <input type="hidden" name="folio" value={p.folio} />
              <input type="hidden" name="version" value={p.version} />
              <CampoKey />
              <p className="aviso-atencion">
                Se {p.piezas === 1 ? 'liberará 1 pieza' : `liberarán ${p.piezas} piezas`}
                {p.hayPagado ? ` y ${p.pagadoTexto} quedará como saldo a favor` : ''}. Esta acción no se puede
                deshacer.
              </p>
              <AreaTexto
                etiqueta="Motivo de la cancelación"
                name="motivo"
                rows={2}
                maxLength={200}
                required
              />
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" name="confirmo" required /> Entiendo que cancelar no se puede deshacer
              </label>
            </Fragment>
          )}
        </FormAccion>
      </section>
    </div>
  );
}
