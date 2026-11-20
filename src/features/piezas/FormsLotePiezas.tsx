'use client';

import Link from 'next/link';
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { MAX_CARACTERES_CODIGOS } from '@/features/exhibidores/codigos';
import { FotoPieza } from '@/features/imagenes/FotoPieza';
import { MensajeError } from '@/features/ui/Campo';
import { ErroresCampo, EstadoDeAccion } from '@/features/ui/errores-campo';
import type { EstadoAccion } from '@/features/ui/estado';
import { FormAccion } from '@/features/ui/FormAccion';
import { buscarElegibles, codigosPegados, unirCodigos, type PiezaElegible } from './lote-piezas';

type Accion = (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>;

/** Textos del botón según cuántas piezas lleva el lote; en `varios`, `{n}` se cambia por el número. */
export type TextosLote = { vacio: string; uno: string; varios: string };

const textoBoton = (t: TextosLote, n: number) =>
  n === 0 ? t.vacio : n === 1 ? t.uno : t.varios.replace('{n}', String(n));

/** Al guardar con éxito (cada resultado nuevo de la acción), limpia la selección. Vive dentro de `FormAccion`. */
function AlGuardar({ limpiar }: { limpiar: () => void }) {
  const estado = useContext(EstadoDeAccion);
  const visto = useRef<EstadoAccion | null>(null);
  useEffect(() => {
    if (!estado.ok || visto.current === estado) return;
    visto.current = estado;
    limpiar();
  }, [estado, limpiar]);
  return null;
}

/**
 * Opción secundaria para lotes grandes o el lector de código de barras. El textarea no tiene `name`: lo pegado
 * se une a lo elegido en el único campo oculto `codigos`, sin repetidos.
 */
function PegarCodigos({
  valor,
  onCambio,
  error,
}: {
  valor: string;
  onCambio: (v: string) => void;
  /** Error del servidor, solo cuando lo pegado es lo que se envió. */
  error?: string;
}) {
  const id = useId();
  const detalles = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (error && detalles.current) detalles.current.open = true;
  }, [error]);
  return (
    <details ref={detalles} className="rounded-lg">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-meta font-medium text-tinta-suave">
        Pegar varios códigos
      </summary>
      <div className="flex flex-col gap-1 pt-1">
        <label htmlFor={id} className="text-meta font-medium">
          Códigos
        </label>
        <textarea
          id={id}
          rows={4}
          value={valor}
          maxLength={MAX_CARACTERES_CODIGOS}
          onChange={(e) => onCambio(e.target.value)}
          placeholder="Uno por línea o separados por espacio o coma"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="campo py-2 font-mono"
        />
        <MensajeError idControl={id} error={error} />
      </div>
    </details>
  );
}

/** Buscador (combobox) sobre la lista de elegibles: código o descripción, hasta 8 resultados. */
function BuscadorElegibles({
  elegibles,
  elegidas,
  onElegir,
  error,
}: {
  elegibles: readonly PiezaElegible[];
  elegidas: ReadonlySet<string>;
  onElegir: (p: PiezaElegible) => void;
  error?: string;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [activo, setActivo] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const resultados = useMemo(() => buscarElegibles(elegibles, q, elegidas), [elegibles, q, elegidas]);
  const visible = abierto && resultados.length > 0;
  const sel = Math.max(0, Math.min(activo, resultados.length - 1));
  const consulta = q.trim();
  const repetida = consulta && [...elegidas].some((c) => c === consulta.toUpperCase());

  function elegir(p: PiezaElegible) {
    onElegir(p);
    setQ('');
    setActivo(0);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-q`} className="text-meta font-medium">
        Buscar pieza
      </label>
      <div className="relative">
        <input
          id={`${id}-q`}
          type="text"
          role="combobox"
          aria-expanded={visible}
          aria-controls={`${id}-lista`}
          aria-activedescendant={visible ? `${id}-op-${sel}` : undefined}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-q-error` : `${id}-ayuda`}
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="done"
          placeholder="Código o descripción"
          value={q}
          onFocus={() => setAbierto(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setActivo(0);
            setAbierto(true);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (!abierto) setAbierto(true);
              else setActivo(Math.min(sel + 1, resultados.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActivo(Math.max(sel - 1, 0));
            } else if (e.key === 'Enter') {
              // Enter elige; nunca envía el formulario a medio armar.
              e.preventDefault();
              if (visible && resultados[sel]) elegir(resultados[sel]);
            } else if (e.key === 'Escape') {
              setAbierto(false);
            }
          }}
          onBlur={() => setAbierto(false)}
          className="campo w-full"
        />
        <ul
          id={`${id}-lista`}
          role="listbox"
          aria-label="Piezas disponibles"
          hidden={!visible}
          className="lista-combo absolute inset-x-0 top-full mt-1 max-h-[min(28rem,60vh)] overflow-y-auto rounded-lg border border-borde bg-superficie shadow"
        >
          {visible &&
            resultados.map((p, i) => (
              <li
                key={p.id}
                id={`${id}-op-${i}`}
                role="option"
                aria-selected={i === sel}
                onMouseMove={() => setActivo(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(p);
                }}
                className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 ${i === sel ? 'bg-rubor-suave' : ''}`}
              >
                <FotoPieza piezaId={p.id} clave={p.imagenClave} alt="" variante="mini" />
                <span className="min-w-0">
                  <span className="block font-mono text-monto font-semibold">{p.codigo}</span>
                  <span className="block truncate text-meta text-tinta-suave">{p.descripcion}</span>
                </span>
              </li>
            ))}
        </ul>
      </div>
      <MensajeError idControl={`${id}-q`} error={error} />
      <p id={`${id}-ayuda`} role="status" className="text-meta text-tinta-suave empty:hidden">
        {consulta && !visible && abierto
          ? repetida
            ? `${consulta.toUpperCase()} ya está en el lote.`
            : `Ninguna pieza disponible coincide con «${consulta}».`
          : ''}
      </p>
    </div>
  );
}

/**
 * Entregar a un asociado o enviar a un exhibidor: solo se ofrecen las piezas elegibles (las calculó el
 * servidor) y cada una entra al lote como etiqueta con «×». El servidor sigue siendo la autoridad: recibe el
 * mismo campo `codigos` de siempre y rechaza todo o nada.
 */
export function FormEntregaLote({
  accion,
  etiqueta,
  elegibles,
  textos,
  children,
}: {
  accion: Accion;
  /** Nombre accesible del formulario. */
  etiqueta: string;
  elegibles: PiezaElegible[];
  textos: TextosLote;
  /** Campos ocultos propios de la acción (vendedorId, exhibidorId). */
  children: ReactNode;
}) {
  const [elegidas, setElegidas] = useState<PiezaElegible[]>([]);
  const [pegado, setPegado] = useState('');
  const codigosElegidos = useMemo(() => new Set(elegidas.map((p) => p.codigo)), [elegidas]);
  const codigos = unirCodigos(
    elegidas.map((p) => p.codigo),
    codigosPegados(pegado),
  );
  const limpiar = useCallback(() => {
    setElegidas([]);
    setPegado('');
  }, []);

  return (
    <FormAccion
      accion={accion}
      etiqueta={etiqueta}
      textoBoton={textoBoton(textos, codigos.length)}
      deshabilitado={codigos.length === 0}
    >
      {children}
      <input type="hidden" name="codigos" value={codigos.join('\n')} />
      <AlGuardar limpiar={limpiar} />
      <ErrorDelLote>
        {(error) => (
          <>
            {elegibles.length === 0 ? (
              <p className="text-meta text-tinta-suave">No hay piezas disponibles en Kazero.</p>
            ) : (
              <BuscadorElegibles
                elegibles={elegibles}
                elegidas={codigosElegidos}
                onElegir={(p) =>
                  setElegidas((xs) => (xs.some((x) => x.codigo === p.codigo) ? xs : [...xs, p]))
                }
                error={pegado.trim() ? undefined : error}
              />
            )}
            {elegidas.length > 0 && (
              <ul aria-label="Piezas del lote" className="flex flex-wrap gap-2">
                {elegidas.map((p) => (
                  <li
                    key={p.codigo}
                    className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border border-borde bg-rubor-suave ps-3"
                  >
                    <span className="font-mono text-dato font-semibold">{p.codigo}</span>
                    <span className="hidden max-w-[14rem] truncate text-meta text-tinta-suave sm:inline">
                      {p.descripcion}
                    </span>
                    <button
                      type="button"
                      aria-label={`Quitar ${p.codigo}`}
                      onClick={() => setElegidas((xs) => xs.filter((x) => x.codigo !== p.codigo))}
                      className="boton-texto size-11 shrink-0 rounded-full px-0 text-lg leading-none"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <PegarCodigos valor={pegado} onCambio={setPegado} error={pegado.trim() ? error : undefined} />
          </>
        )}
      </ErrorDelLote>
    </FormAccion>
  );
}

/** El error del campo `codigos` (lo da `FormAccion`); el lote decide en qué control colgarlo. */
function ErrorDelLote({ children }: { children: (error: string | undefined) => ReactNode }) {
  return <>{children(useContext(ErroresCampo).codigos)}</>;
}

export type PiezaARegresar = {
  codigo: string;
  descripcion: string;
  /** Solo las que el servidor aceptaría regresar llevan casilla (p. ej. las apartadas no). */
  seleccionable: boolean;
  /** Dato extra a la derecha: estado, folio o precio. */
  nota?: ReactNode;
};

/**
 * Regresar a Kazero o regresar del exhibidor: la lista de lo que tiene lleva una casilla por pieza, más
 * «Seleccionar todas». Sin teclear; «Pegar varios códigos» queda como opción plegada.
 */
export function FormRegresoLote({
  accion,
  etiqueta,
  etiquetaLista,
  piezas,
  textos,
  sinPiezas,
  children,
}: {
  accion: Accion;
  etiqueta: string;
  /** Nombre accesible de la lista de piezas. */
  etiquetaLista: string;
  piezas: PiezaARegresar[];
  textos: TextosLote;
  /** Texto cuando ya no hay nada que regresar. El formulario sigue montado: su aviso de éxito no se pierde. */
  sinPiezas: string;
  children: ReactNode;
}) {
  const idTodas = useId();
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [pegado, setPegado] = useState('');
  const todas = useRef<HTMLInputElement>(null);
  const seleccionables = piezas.filter((p) => p.seleccionable).map((p) => p.codigo);
  // Solo cuentan las que siguen en la lista (tras revalidar, una pieza pudo salir).
  const vigentes = seleccionables.filter((c) => marcadas.has(c));
  const codigos = unirCodigos(vigentes, codigosPegados(pegado));
  const estadoTodas =
    vigentes.length === 0 ? 'ninguna' : vigentes.length === seleccionables.length ? 'todas' : 'algunas';
  useEffect(() => {
    if (todas.current) todas.current.indeterminate = estadoTodas === 'algunas';
  }, [estadoTodas]);
  const limpiar = useCallback(() => {
    setMarcadas(new Set());
    setPegado('');
  }, []);
  const alternar = (codigo: string, si: boolean) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (si) n.add(codigo);
      else n.delete(codigo);
      return n;
    });

  return (
    <FormAccion
      accion={accion}
      etiqueta={etiqueta}
      textoBoton={textoBoton(textos, codigos.length)}
      deshabilitado={codigos.length === 0}
      sinControles={piezas.length === 0}
    >
      {children}
      <input type="hidden" name="codigos" value={codigos.join('\n')} />
      <AlGuardar limpiar={limpiar} />
      <ErrorDelLote>
        {(error) => {
          if (piezas.length === 0) return <p className="text-meta text-tinta-suave">{sinPiezas}</p>;
          // Sin lo pegado, el error cuelga de «Seleccionar todas», el control principal de la lista.
          const errorLista = pegado.trim() || seleccionables.length === 0 ? undefined : error;
          return (
            <>
              {seleccionables.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="casilla-fila self-start pe-3 text-dato font-medium">
                    <span className="casilla-caja">
                      <input
                        ref={todas}
                        id={idTodas}
                        type="checkbox"
                        checked={estadoTodas === 'todas'}
                        onChange={(e) => setMarcadas(e.target.checked ? new Set(seleccionables) : new Set())}
                        aria-invalid={errorLista ? true : undefined}
                        aria-describedby={errorLista ? `${idTodas}-error` : undefined}
                      />
                      <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12">
                        <path d="M2 6.4 4.8 9 10 3.2" />
                      </svg>
                    </span>
                    <span>Seleccionar todas ({seleccionables.length})</span>
                  </label>
                  <MensajeError idControl={idTodas} error={errorLista} />
                </div>
              )}
              <ul
                aria-label={etiquetaLista}
                className="tarjeta flex flex-col divide-y divide-borde ps-2 pe-4 text-dato"
              >
                {piezas.map((p) => (
                  <li key={p.codigo} className="flex flex-wrap items-center gap-x-2 py-0.5">
                    {p.seleccionable ? (
                      <label className="casilla-fila shrink-0">
                        <span className="casilla-caja">
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar ${p.codigo}`}
                            checked={marcadas.has(p.codigo)}
                            onChange={(e) => alternar(p.codigo, e.target.checked)}
                          />
                          <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12">
                            <path d="M2 6.4 4.8 9 10 3.2" />
                          </svg>
                        </span>
                      </label>
                    ) : (
                      // Mismo ancho que la casilla: los códigos quedan alineados.
                      <span aria-hidden="true" className="w-8 shrink-0" />
                    )}
                    <Link
                      href={`/panel/inventario/${encodeURIComponent(p.codigo)}`}
                      className="enlace inline-flex min-h-11 items-center font-mono text-monto font-semibold"
                    >
                      {p.codigo}
                    </Link>
                    <span className="min-w-0 flex-1">{p.descripcion}</span>
                    {p.nota && <span className="text-tinta-suave">{p.nota}</span>}
                  </li>
                ))}
              </ul>
              <PegarCodigos valor={pegado} onCambio={setPegado} error={pegado.trim() ? error : undefined} />
            </>
          );
        }}
      </ErrorDelLote>
    </FormAccion>
  );
}
