'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { formatoMXN, pesosACentavos } from '@/domain/dinero';
import { fechaCorta } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import { AvisoDuplicado } from '@/features/pagos/AvisoDuplicado';
import { CampoCaptura } from '@/features/pagos/CampoCaptura';
import { avisoSinCaptura, montosDeReparto, resumenReparto } from '@/features/pagos/formato';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { Campo, Selector } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { accionPagoAgrupado } from '../../pedidos/acciones';
import { ETIQUETA_METODO } from '../../pedidos/etiquetas';

export interface PedidoAbierto {
  id: string;
  folio: number;
  fecha: string;
  clienteNombre: string;
  saldoCentavos: number;
}

const METODOS = Object.entries(ETIQUETA_METODO).map(([valor, texto]) => ({ valor, texto }));

/**
 * Campos del pago agrupado. Mientras la usuaria no toque un reparto, el sugerido (del pedido más viejo al más nuevo,
 * R-33) sigue al monto; en cuanto edita un pedido, el reparto es suyo y solo vuelve a sugerirse con el botón.
 */
function Campos({ vendedorId, nombre, pedidos, hoy }: Props) {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('transferencia');
  const [hayCaptura, setHayCaptura] = useState(false);
  const [manual, setManual] = useState<Record<string, string> | null>(null);
  const montoCentavos = pesosACentavos(monto) ?? 0;
  const montos = useMemo(
    () => manual ?? montosDeReparto(montoCentavos, pedidos),
    [manual, montoCentavos, pedidos],
  );
  const r = resumenReparto(montoCentavos, montos, pedidos);
  const aviso = avisoSinCaptura(metodo, hayCaptura);
  const sinPedidos = pedidos.length === 0;
  return (
    <>
      <input type="hidden" name="vendedorId" value={vendedorId} />
      <CampoKey />
      <Campo
        etiqueta="Monto del pago"
        name="monto"
        inputMode="decimal"
        value={monto}
        onChange={(e) => setMonto(e.target.value)}
        required
        autoComplete="off"
      />
      <Selector
        etiqueta="Método"
        name="metodo"
        required
        value={metodo}
        onChange={setMetodo}
        opciones={METODOS}
      />
      <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} required />
      <Campo etiqueta="Referencia (opcional)" name="referencia" maxLength={60} autoComplete="off" />
      <CampoCaptura onCambio={setHayCaptura} />
      {aviso && <p className="text-meta text-tinta-suave">{aviso}</p>}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-meta font-medium">Reparto entre sus pedidos abiertos</legend>
        {sinPedidos ? (
          <p className="text-meta text-tinta-suave">
            {nombre} no tiene pedidos abiertos con saldo: todo el pago quedará como saldo a favor suyo.
          </p>
        ) : (
          <>
            <p className="text-meta text-tinta-suave">
              Se reparte del pedido más viejo al más nuevo. Cambia un monto si necesitas otro reparto; deja
              vacío el pedido que no se paga.
            </p>
            <ul className="tarjeta flex flex-col divide-y divide-borde px-4">
              {pedidos.map((p) => {
                const error = r.errores[p.id];
                const idCampo = `reparto-${p.id}`;
                return (
                  <li key={p.id} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 text-dato">
                      <Link href={`/panel/pedidos/${p.folio}`} className="enlace font-mono font-semibold">
                        {formatoFolio(p.folio)}
                      </Link>
                      <span className="min-w-0 flex-1">{p.clienteNombre}</span>
                      <span className="text-meta text-tinta-suave">{fechaCorta(p.fecha)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <label htmlFor={idCampo} className="text-meta text-tinta-suave">
                        Saldo {formatoMXN(p.saldoCentavos)}. Aplicar
                      </label>
                      <input type="hidden" name="pedidoId" value={p.id} />
                      <input
                        id={idCampo}
                        name="montoPedido"
                        inputMode="decimal"
                        autoComplete="off"
                        className="campo w-36 tabular-nums"
                        value={montos[p.id] ?? ''}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${idCampo}-error` : undefined}
                        onChange={(e) => setManual({ ...montos, [p.id]: e.target.value })}
                      />
                    </div>
                    {error && (
                      <span id={`${idCampo}-error`} className="mensaje-error text-meta text-error">
                        {error}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {manual && (
              <button type="button" className="boton-texto self-start" onClick={() => setManual(null)}>
                Volver al reparto sugerido
              </button>
            )}
          </>
        )}
        {/* Resumen en vivo: lo repartido, lo que sobra (va a su saldo a favor) o cuánto se pasa. */}
        <p
          role="status"
          className={`tabular-nums ${r.excedeCentavos > 0 ? 'aviso-error' : 'text-dato'}`}
          aria-live="polite"
        >
          {r.excedeCentavos > 0
            ? `Lo repartido se pasa ${formatoMXN(r.excedeCentavos)} del pago. Baja algún monto.`
            : r.sobranteCentavos > 0
              ? `Repartido ${formatoMXN(r.aplicadoCentavos)}. Sobran ${formatoMXN(r.sobranteCentavos)}: quedan como saldo a favor de ${nombre}.`
              : `Repartido ${formatoMXN(r.aplicadoCentavos)}. No sobra nada.`}
        </p>
      </fieldset>
      <AvisoDuplicado />
    </>
  );
}

interface Props {
  vendedorId: string;
  nombre: string;
  pedidos: PedidoAbierto[];
  hoy: string;
}

export function FormPagoAgrupado(p: Props) {
  // La llave refresca los campos y la llave de idempotencia tras guardar (los saldos de la lista cambian).
  const marca = p.pedidos.map((x) => `${x.id}:${x.saldoCentavos}`).join('|');
  return (
    <FormAccion accion={accionPagoAgrupado} textoBoton="Registrar pago agrupado">
      <Fragment key={marca}>
        <Campos {...p} />
      </Fragment>
    </FormAccion>
  );
}
