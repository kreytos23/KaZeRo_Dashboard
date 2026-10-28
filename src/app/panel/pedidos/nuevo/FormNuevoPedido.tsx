'use client';

import { useRouter } from 'next/navigation';
import { useContext, useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { normalizarCodigo } from '@/domain/codigos';
import { formatoMXN, numericACentavos, pesosACentavos } from '@/domain/dinero';
import { MAX_PIEZAS_PEDIDO, calcularTotales, formatoFolio } from '@/domain/pedidos';
import { BuscarPieza } from '@/features/pedidos/BuscarPieza';
import { CampoKey } from '@/features/pedidos/CampoKey';
import { urlConsultaPrevia } from '@/features/pedidos/consulta-previa';
import { ResumenTotales } from '@/features/pedidos/ResumenTotales';
import { SelectorCliente, type ClienteElegido } from '@/features/pedidos/SelectorCliente';
import { textoLealtadPrevia } from '@/features/pedidos/texto-lealtad';
import type { PreviaPedido } from '@/features/pedidos/tipos';
import { vendedorPorDefecto } from '@/features/pedidos/vendedor-por-defecto';
import { AreaTexto, Campo, CampoCasilla, Selector } from '@/features/ui/Campo';
import { ErroresCampo } from '@/features/ui/errores-campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { marcarIndiceSucio } from '@/search/eventos';
import { accionCrearPedido } from '../acciones';

interface Props {
  vendedores: { id: string; nombre: string; tipo: string }[];
  clienteInicial: (ClienteElegido & { vendedorHabitualId: string | null }) | null;
  hoy: string;
}

/** Error del servidor sobre la lista de piezas (campo `codigos`), enlazado con la lista por aria-describedby. */
function ErrorCodigos({ id }: { id: string }) {
  const error = useContext(ErroresCampo).codigos;
  if (!error) return null;
  return (
    <p id={id} className="text-meta text-error">
      {error}
    </p>
  );
}

/**
 * Campo para agregar piezas. El error del servidor sobre la lista (`codigos`) se marca aquí —`aria-invalid` y
 * `aria-describedby` solo cuando hay error—: es el control donde se corrige, y recibe el foco al fallar.
 */
function CampoCodigoPieza({ idError, ...props }: { idError: string } & ComponentProps<typeof Campo>) {
  const hayError = Boolean(useContext(ErroresCampo).codigos);
  return (
    <Campo
      {...props}
      aria-invalid={hayError ? true : undefined}
      aria-describedby={hayError ? idError : undefined}
    />
  );
}

export function FormNuevoPedido({ vendedores, clienteInicial, hoy }: Props) {
  const router = useRouter();
  const idErrorCodigos = useId();
  const [cliente, setCliente] = useState<ClienteElegido | null>(clienteInicial);
  // null = el usuario no ha tocado el vendedor: sigue al habitual del cliente (D-1).
  const [vendedorElegido, setVendedorElegido] = useState<string | null>(null);
  const [codigos, setCodigos] = useState<string[]>([]);
  const [codigo, setCodigo] = useState('');
  const [cuentaTarjeta, setCuentaTarjeta] = useState(true);
  const [manual, setManual] = useState('');
  const [previa, setPrevia] = useState<PreviaPedido | null>(null);
  const enviado = useRef(false);

  // El éxito redirige desde el servidor y este formulario se desmonta: ahí se avisa al buscador.
  useEffect(
    () => () => {
      if (enviado.current) marcarIndiceSucio();
    },
    [],
  );

  // Vista previa: una petición por cambio (200 ms de espera, AbortController para la anterior).
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(urlConsultaPrevia({ clienteId: cliente?.id ?? null, codigos, cuentaTarjeta }), {
          cache: 'no-store',
          signal: ctl.signal,
        });
        if (r.status === 401) return router.replace('/login');
        if (r.ok) setPrevia((await r.json()) as PreviaPedido);
      } catch {
        /* abortada o sin red: se conserva la última vista previa */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [cliente?.id, codigos, cuentaTarjeta, router]);

  // La vista previa puede ir un paso atrás de lo que el usuario ya cambió: solo se usa lo que sigue vigente.
  const previaDelCliente = previa && previa.cliente?.id === cliente?.id ? previa : null;
  const vendedorId =
    vendedorElegido ?? vendedorPorDefecto(vendedores, previaDelCliente?.cliente ?? clienteInicial);
  const piezasDe = (c: string) => previa?.piezas.find((x) => x.codigo === c);
  const disponibles = codigos.flatMap((c) => {
    const p = piezasDe(c);
    return p?.disponible ? [p] : [];
  });
  const manualCentavos = pesosACentavos(manual.trim() || '0') ?? 0;
  // Totales con la MISMA función que usa el servidor (spec §3.1). Solo cuentan las piezas disponibles.
  const totales = calcularTotales(
    disponibles.map((p) => numericACentavos(p.precio)),
    cuentaTarjeta ? (previaDelCliente?.tarjeta?.pctBps ?? 0) : 0,
    manualCentavos,
  );

  function agregar(bruto: string) {
    const c = normalizarCodigo(bruto);
    if (c && !codigos.includes(c) && codigos.length < MAX_PIEZAS_PEDIDO) setCodigos([...codigos, c]);
    setCodigo('');
  }

  return (
    <div className="max-w-2xl" onSubmit={() => (enviado.current = true)}>
      <FormAccion accion={accionCrearPedido} textoBoton="Crear pedido">
        <CampoKey />
        <SelectorCliente
          inicial={clienteInicial}
          onElegir={(c) => {
            setCliente(c);
            setVendedorElegido(null);
          }}
        />
        <Selector
          etiqueta="Vendedor"
          name="vendedorId"
          required
          opciones={vendedores.map((v) => ({ valor: v.id, texto: v.nombre }))}
          value={vendedorId}
          onChange={setVendedorElegido}
        />
        <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} required />

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <CampoCodigoPieza
              idError={idErrorCodigos}
              etiqueta="Código de pieza"
              name="_codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  agregar(codigo);
                }
              }}
              autoComplete="off"
              autoCapitalize="characters"
              enterKeyHint="next"
              maxLength={40}
            />
          </div>
          <button type="button" onClick={() => agregar(codigo)} className="boton-secundario">
            Agregar pieza
          </button>
        </div>
        <BuscarPieza onElegir={agregar} />

        <ul
          aria-label="Piezas del pedido"
          className="tarjeta flex flex-col divide-y divide-borde px-4 empty:hidden"
        >
          {codigos.map((c) => {
            const p = piezasDe(c);
            return (
              <li key={c} className="flex items-center gap-3 py-2">
                <input type="hidden" name="codigo" value={c} />
                {p?.imagenClave ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura privada servida por /api con sesión
                  <img
                    src={`/api/piezas/${p.id}/imagen?t=mini&v=${p.imagenClave}`}
                    alt=""
                    width={40}
                    height={40}
                    loading="lazy"
                    decoding="async"
                    className="size-10 shrink-0 rounded border border-borde bg-superficie object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="size-10 shrink-0 rounded border border-borde bg-superficie"
                  />
                )}
                <span className="min-w-0 flex-1 text-dato">
                  <span className="font-mono font-medium">{c}</span>
                  {' · '}
                  {p
                    ? `${p.descripcion} · ${formatoMXN(numericACentavos(p.precio))}`
                    : previa?.faltantes.includes(c)
                      ? 'No existe'
                      : '…'}
                  {p?.disponible && p.vendedorCustodiaId && (
                    <span className={p.vendedorCustodiaId === vendedorId ? 'text-tinta-suave' : 'text-error'}>
                      {' · '}Con {p.vendedorCustodiaNombre ?? 'otra vendedora'}
                      {p.vendedorCustodiaId === vendedorId
                        ? ''
                        : ': la nota debe ser de esa vendedora o hay que regresarla a Kazero'}
                    </span>
                  )}
                  {p && !p.disponible && (
                    <span className="text-error">
                      {' · '}No disponible
                      {p.folioApartada ? ` (apartada en ${formatoFolio(p.folioApartada)})` : ` (${p.estado})`}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Quitar ${c}`}
                  onClick={() => setCodigos(codigos.filter((x) => x !== c))}
                  className="min-h-11 min-w-11 rounded-lg text-xl hover:bg-rubor-suave"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <ErrorCodigos id={idErrorCodigos} />

        <CampoCasilla
          name="cuentaTarjeta"
          checked={cuentaTarjeta}
          onChange={(e) => setCuentaTarjeta(e.target.checked)}
        >
          Cuenta para la tarjeta de lealtad
        </CampoCasilla>
        <Campo
          etiqueta="Descuento manual"
          name="descuentoManual"
          inputMode="decimal"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="0"
          autoComplete="off"
        />
        <Campo
          etiqueta="Motivo del descuento"
          name="descuentoMotivo"
          maxLength={200}
          required={manualCentavos > 0}
          autoComplete="off"
        />
        <AreaTexto etiqueta="Notas" name="notas" rows={2} maxLength={500} />

        <ResumenTotales
          totales={totales}
          textoLealtad={textoLealtadPrevia(previaDelCliente?.tarjeta ?? null, {
            cuentaTarjeta,
            hayCliente: !!cliente,
          })}
        />
      </FormAccion>
    </div>
  );
}
