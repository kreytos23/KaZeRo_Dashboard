'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { normalizarCodigo } from '@/domain/codigos';
import { centavosANumeric, formatoMXN, numericACentavos, pesosACentavos } from '@/domain/dinero';
import { calcularTotales } from '@/domain/pedidos';
import { MAX_CARACTERES_CODIGOS } from '@/features/exhibidores/codigos';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { urlConsultaPrevia } from '@/features/pedidos/consulta-previa';
import { SelectorCliente, type ClienteElegido } from '@/features/pedidos/SelectorCliente';
import type { PreviaPedido } from '@/features/pedidos/tipos';
import { AreaTexto, Campo, CampoCasilla, Selector } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { ETIQUETA_METODO } from '../../pedidos/etiquetas';
import {
  accionAbonoExhibidor,
  accionRegistrarAjuste,
  accionRegistrarEntrega,
  accionRegistrarVenta,
} from '../acciones';

const METODOS = Object.entries(ETIQUETA_METODO).map(([valor, texto]) => ({ valor, texto }));

/** Códigos del cuadro de texto (mismos separadores que «Enviar piezas»), sin repetidos. */
function codigosDeTexto(t: string): string[] {
  return [
    ...new Set(
      t
        .slice(0, MAX_CARACTERES_CODIGOS)
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(normalizarCodigo),
    ),
  ];
}

/** Método y fecha, comunes a la venta, el abono y la entrega. */
function CamposMetodoFecha({ hoy }: { hoy: string }) {
  return (
    <>
      <Selector etiqueta="Método" name="metodo" required defaultValue="efectivo" opciones={METODOS} />
      <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} required />
    </>
  );
}

/**
 * Campos de la venta. «Cobrado» sigue al total de la nota (vista previa del servidor, la misma cuenta que el
 * pedido) hasta que se escribe otro monto. Viven dentro del Fragment con llave: tras registrar, se reinician.
 */
function CamposVenta({ hoy }: { hoy: string }) {
  const router = useRouter();
  const [codigos, setCodigos] = useState('');
  const [mostrador, setMostrador] = useState(false);
  const [cliente, setCliente] = useState<ClienteElegido | null>(null);
  const [cobradoManual, setCobradoManual] = useState<string | null>(null);
  const [previa, setPrevia] = useState<PreviaPedido | null>(null);

  const lista = codigosDeTexto(codigos);
  const clave = lista.join(',');
  const clienteId = mostrador ? null : (cliente?.id ?? null);
  useEffect(() => {
    if (!clave) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          urlConsultaPrevia({ clienteId, codigos: clave.split(','), cuentaTarjeta: !mostrador }),
          { cache: 'no-store', signal: ctl.signal },
        );
        if (r.status === 401) return router.replace('/login');
        if (r.ok) setPrevia((await r.json()) as PreviaPedido);
      } catch {
        /* abortada o sin red: se conserva la última vista previa */
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [clave, clienteId, mostrador, router]);

  // La vista previa puede ir un paso atrás de lo que ya se cambió: solo se usa si sigue vigente.
  const vigente = clave !== '' && previa !== null && (mostrador || previa.cliente?.id === cliente?.id);
  const precios = vigente
    ? previa.piezas
        .filter((p) => p.disponible && lista.includes(p.codigo))
        .map((p) => numericACentavos(p.precio))
    : [];
  const total = calcularTotales(precios, mostrador ? 0 : (previa?.tarjeta?.pctBps ?? 0), 0).total;
  const cobrado = cobradoManual ?? (total > 0 ? centavosANumeric(total) : '');
  const cobradoCentavos = pesosACentavos(cobrado.trim() || '0') ?? 0;

  return (
    <>
      <AreaTexto
        etiqueta="Códigos vendidos"
        name="codigos"
        rows={3}
        required
        maxLength={MAX_CARACTERES_CODIGOS}
        onChange={setCodigos}
        placeholder="Uno por línea o separados por espacio o coma"
      />
      <CampoCasilla
        name="mostrador"
        checked={mostrador}
        onChange={(e) => {
          setMostrador(e.target.checked);
          setCliente(null);
        }}
      >
        Sin clienta (venta de mostrador)
      </CampoCasilla>
      {!mostrador && <SelectorCliente inicial={null} onElegir={setCliente} />}
      <p aria-live="polite" className="text-monto font-semibold tabular-nums">
        Total de la nota: {formatoMXN(total)}
      </p>
      <Campo
        etiqueta="Cobrado por el exhibidor"
        name="cobrado"
        inputMode="decimal"
        value={cobrado}
        onChange={(e) => setCobradoManual(e.target.value)}
        autoComplete="off"
      />
      {cobradoCentavos > 0 && cobradoCentavos < total && (
        <p className="text-dato text-tinta-suave">
          La nota queda con saldo de {formatoMXN(total - cobradoCentavos)}.
        </p>
      )}
      <CamposMetodoFecha hoy={hoy} />
    </>
  );
}

/** Venta en un paso: códigos en ráfaga, clienta (o mostrador) y lo cobrado. */
export function FormVenta({ exhibidorId, hoy, marca }: { exhibidorId: string; hoy: string; marca: string }) {
  return (
    <section aria-labelledby="registrar-venta" className="flex flex-col gap-2">
      <h2 id="registrar-venta" className="text-lg font-semibold">
        Registrar venta
      </h2>
      <FormAccion accion={accionRegistrarVenta} textoBoton="Registrar venta">
        <Fragment key={marca}>
          <input type="hidden" name="exhibidorId" value={exhibidorId} />
          <CampoKey />
          <CamposVenta hoy={hoy} />
        </Fragment>
      </FormAccion>
    </section>
  );
}

export interface NotaAbierta {
  pedidoId: string;
  folio: number;
  etiqueta: string;
  /** numeric del saldo pendiente. */
  saldo: string;
}

function CamposAbono({ notas, hoy }: { notas: NotaAbierta[]; hoy: string }) {
  const [folio, setFolio] = useState(String(notas[0]!.folio));
  const [monto, setMonto] = useState<{ folio: string; valor: string } | null>(null);
  const nota = notas.find((n) => String(n.folio) === folio) ?? notas[0]!;
  // El monto propone el saldo de la nota elegida hasta que se escribe otro.
  const valor = monto?.folio === folio ? monto.valor : nota.saldo;
  return (
    <>
      <input type="hidden" name="pedidoId" value={nota.pedidoId} />
      <input type="hidden" name="folio" value={nota.folio} />
      <Selector
        etiqueta="Nota"
        name="_nota"
        value={folio}
        onChange={setFolio}
        opciones={notas.map((n) => ({ valor: String(n.folio), texto: n.etiqueta }))}
      />
      <Campo
        etiqueta="Monto"
        name="monto"
        inputMode="decimal"
        value={valor}
        onChange={(e) => setMonto({ folio, valor: e.target.value })}
        required
        autoComplete="off"
      />
      <CamposMetodoFecha hoy={hoy} />
    </>
  );
}

/** Abono a una nota abierta del exhibidor, cobrado por él (E-4). */
export function FormAbono({
  exhibidorId,
  notas,
  hoy,
  marca,
}: {
  exhibidorId: string;
  notas: NotaAbierta[];
  hoy: string;
  marca: string;
}) {
  return (
    <section aria-labelledby="registrar-abono" className="flex flex-col gap-2">
      <h2 id="registrar-abono" className="text-lg font-semibold">
        Registrar abono
      </h2>
      <FormAccion
        accion={accionAbonoExhibidor}
        textoBoton="Registrar abono"
        sinControles={notas.length === 0}
      >
        {notas.length > 0 ? (
          <Fragment key={marca}>
            <input type="hidden" name="exhibidorId" value={exhibidorId} />
            <CampoKey />
            <CamposAbono notas={notas} hoy={hoy} />
          </Fragment>
        ) : (
          <p className="text-dato text-tinta-suave">Ninguna nota de este exhibidor tiene saldo.</p>
        )}
      </FormAccion>
    </section>
  );
}

/** Lo que el exhibidor le entrega a Kazero (parcial o total). */
export function FormEntrega({
  exhibidorId,
  porEntregar,
  hoy,
  marca,
}: {
  exhibidorId: string;
  /** numeric del por entregar, para proponerlo completo. */
  porEntregar: string;
  hoy: string;
  marca: string;
}) {
  return (
    <section aria-labelledby="registrar-entrega" className="flex flex-col gap-2">
      <h2 id="registrar-entrega" className="text-lg font-semibold">
        Registrar entrega
      </h2>
      <FormAccion accion={accionRegistrarEntrega} textoBoton="Registrar entrega">
        <Fragment key={marca}>
          <input type="hidden" name="exhibidorId" value={exhibidorId} />
          <CampoKey />
          <Campo
            etiqueta="Monto entregado"
            name="monto"
            inputMode="decimal"
            defaultValue={porEntregar}
            required
            autoComplete="off"
          />
          <CamposMetodoFecha hoy={hoy} />
          <Campo etiqueta="Nota" name="nota" maxLength={200} autoComplete="off" />
        </Fragment>
      </FormAccion>
    </section>
  );
}

/** Corrige el por entregar (suma o resta); vive en «Más acciones» y pide motivo y confirmación. */
export function FormAjuste({ exhibidorId, hoy, marca }: { exhibidorId: string; hoy: string; marca: string }) {
  return (
    <FormAccion accion={accionRegistrarAjuste} textoBoton="Registrar ajuste">
      <Fragment key={marca}>
        <input type="hidden" name="exhibidorId" value={exhibidorId} />
        <CampoKey />
        <Selector
          etiqueta="El ajuste"
          name="direccion"
          required
          defaultValue="resta"
          opciones={[
            { valor: 'resta', texto: 'Resta del por entregar' },
            { valor: 'suma', texto: 'Suma al por entregar' },
          ]}
        />
        <Campo etiqueta="Monto" name="monto" inputMode="decimal" required autoComplete="off" />
        <Campo etiqueta="Motivo" name="motivo" required maxLength={200} autoComplete="off" />
        <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} required />
        <CampoCasilla name="confirmo" required>
          Confirmo que este ajuste cambia lo que el exhibidor debe entregar
        </CampoCasilla>
      </Fragment>
    </FormAccion>
  );
}
