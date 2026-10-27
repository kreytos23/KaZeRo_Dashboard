'use client';

import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useCombobox } from '@/features/ui/useCombobox';
import { crearMotor, type Resultado } from './motor';
import { useIndiceBusqueda } from './useIndiceBusqueda';

const CLAVE_RECIENTES = 'kazero:recientes';
const MAX_RECIENTES = 20;
const ETIQUETA_TIPO: Record<Resultado['tipo'], string> = {
  pieza: 'Pieza',
  cliente: 'Cliente',
  vendedor: 'Vendedor',
  pedido: 'Nota',
};

// localStorage puede no existir o lanzar (modo privado): solo es una comodidad.
// Se guardan únicamente claves (`pieza:<id>`), nunca nombres ni descripciones.
function leerRecientes(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLAVE_RECIENTES) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function guardarReciente(clave: string) {
  try {
    const nuevos = [clave, ...leerRecientes().filter((c) => c !== clave)].slice(0, MAX_RECIENTES);
    localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(nuevos));
  } catch {
    /* sin almacenamiento: se ignora */
  }
}

function esCampoDeTexto(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable;
}

export function BuscadorGlobal() {
  const router = useRouter();
  const id = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const { indice, estado, asegurarCarga } = useIndiceBusqueda();
  const [recientes, setRecientes] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const atajo = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.defaultPrevented || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (esCampoDeTexto(e.target)) return;
      e.preventDefault();
      asegurarCarga();
      entrada.current?.focus();
    };
    window.addEventListener('keydown', atajo);
    return () => window.removeEventListener('keydown', atajo);
  }, [asegurarCarga]);

  const motor = useMemo(() => (indice ? crearMotor(indice) : null), [indice]);
  const consulta = useDeferredValue(q);
  const resultados = useMemo(
    () => (motor ? motor.buscar(consulta, recientes) : []),
    [motor, consulta, recientes],
  );
  const { sel, setActivo, reiniciar, visible, idLista, idOpcion, idActivo, onKeyDown } = useCombobox({
    id,
    cantidad: resultados.length,
    abierto,
    setAbierto,
    alElegir: (i) => abrir(resultados[i]!),
  });

  function abrir(r: Resultado) {
    guardarReciente(r.clave);
    setRecientes(leerRecientes());
    setQ('');
    setAbierto(false);
    router.push(r.href);
  }

  let aviso: string | null = null;
  if (estado === 'cargando' && !indice) aviso = 'Cargando búsqueda…';
  else if (estado === 'sin_sesion') aviso = 'Tu sesión terminó. Inicia sesión de nuevo.';
  else if (estado === 'error')
    aviso = 'No se pudo cargar la búsqueda. Revisa tu conexión y vuelve a enfocar el campo.';
  else if (estado === 'listo' && abierto && consulta.trim() && resultados.length === 0)
    aviso = 'Sin resultados';
  else if (visible) aviso = resultados.length === 1 ? '1 resultado' : `${resultados.length} resultados`;

  return (
    <div className="w-full max-w-md md:relative">
      <label htmlFor={`${id}-q`} className="sr-only">
        Buscar
      </label>
      <input
        id={`${id}-q`}
        ref={entrada}
        type="search"
        role="combobox"
        aria-expanded={visible}
        aria-controls={idLista}
        aria-activedescendant={idActivo}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Buscar"
        value={q}
        onFocus={() => {
          asegurarCarga();
          setRecientes(leerRecientes());
          setAbierto(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          reiniciar();
          setAbierto(true);
        }}
        onClick={() => setAbierto(true)}
        onKeyDown={onKeyDown}
        onBlur={() => setAbierto(false)}
        className="campo"
      />
      {q === '' && (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-3 right-3 hidden rounded border border-borde-campo px-1.5 font-mono text-meta text-tinta-suave md:block"
        >
          /
        </kbd>
      )}
      <div
        role="status"
        aria-live="polite"
        className={aviso && !visible ? 'mt-1 text-meta text-tinta-suave' : 'sr-only'}
      >
        {aviso}
      </div>
      <ul
        id={idLista}
        role="listbox"
        aria-label="Resultados"
        hidden={!visible}
        className="lista-combo absolute inset-x-4 mt-1 overflow-hidden md:inset-x-auto md:w-full rounded-lg border border-borde bg-superficie shadow"
      >
        {visible &&
          resultados.map((r, i) => (
            <li
              key={r.clave}
              id={idOpcion(i)}
              role="option"
              aria-selected={i === sel}
              onMouseMove={() => setActivo(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                abrir(r);
              }}
              className={`min-h-11 cursor-pointer px-3 py-2 ${i === sel ? 'bg-rubor-suave' : ''}`}
            >
              <span className="flex items-center gap-3">
                {r.tipo === 'pieza' &&
                  (r.miniatura ? (
                    // eslint-disable-next-line @next/next/no-img-element -- miniatura privada servida por /api con sesión
                    <img
                      src={r.miniatura}
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
                  ))}
                <span className="min-w-0">
                  <span className="block text-meta font-semibold uppercase tracking-wide text-tinta-suave">
                    {ETIQUETA_TIPO[r.tipo]}
                  </span>
                  <span className="block text-dato font-medium">{r.titulo}</span>
                  <span className="block text-meta text-tinta-suave">{r.subtitulo}</span>
                </span>
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
