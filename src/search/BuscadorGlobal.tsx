'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { EVENTO_INDICE_SUCIO } from './eventos';
import { crearMotor, type Resultado } from './motor';
import type { IndiceBusqueda } from './tipos';

const CLAVE_RECIENTES = 'kazero:recientes';
const MAX_RECIENTES = 20;
// Red de seguridad por si algún formulario olvida llamar a marcarIndiceSucio().
const TTL_INDICE_MS = 5 * 60 * 1000;
const ETIQUETA_TIPO: Record<Resultado['tipo'], string> = {
  pieza: 'Pieza',
  cliente: 'Cliente',
  vendedor: 'Vendedor',
};

type Estado = 'inactivo' | 'cargando' | 'listo' | 'sin_sesion' | 'error';

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

function esIndice(v: unknown): v is IndiceBusqueda {
  if (typeof v !== 'object' || v === null) return false;
  const i = v as Partial<IndiceBusqueda>;
  return i.v === 2 && Array.isArray(i.piezas) && Array.isArray(i.clientes) && Array.isArray(i.vendedores);
}

function esCampoDeTexto(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable;
}

export function BuscadorGlobal() {
  const router = useRouter();
  const id = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const estadoRef = useRef<Estado>('inactivo');
  const peticion = useRef(0);
  const cargadoEn = useRef(0);
  const [estado, setEstado] = useState<Estado>('inactivo');
  const [indice, setIndice] = useState<IndiceBusqueda | null>(null);
  const [recientes, setRecientes] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [activo, setActivo] = useState(0);
  const [abierto, setAbierto] = useState(false);

  const cambiarEstado = useCallback((e: Estado) => {
    estadoRef.current = e;
    setEstado(e);
  }, []);

  const cargar = useCallback(async () => {
    const mia = ++peticion.current;
    cambiarEstado('cargando');
    try {
      const r = await fetch('/api/busqueda/indice', { cache: 'no-store' });
      if (mia !== peticion.current) return; // llegó una carga más reciente
      if (r.status === 401) {
        setIndice(null);
        cambiarEstado('sin_sesion');
        router.replace('/login');
        return;
      }
      if (!r.ok) {
        cambiarEstado('error');
        return;
      }
      const datos: unknown = await r.json();
      if (mia !== peticion.current) return;
      if (!esIndice(datos)) {
        cambiarEstado('error');
        return;
      }
      setIndice(datos);
      cargadoEn.current = Date.now();
      cambiarEstado('listo');
    } catch {
      if (mia === peticion.current) cambiarEstado('error');
    }
  }, [cambiarEstado, router]);

  // Carga perezosa: al enfocar el campo o al pulsar `/` por primera vez; después, solo si el índice caducó.
  const asegurarCarga = useCallback(() => {
    const e = estadoRef.current;
    if (e === 'inactivo' || e === 'error') void cargar();
    else if (e === 'listo' && Date.now() - cargadoEn.current > TTL_INDICE_MS) void cargar();
  }, [cargar]);

  // Un formulario avisó que guardó: si ya se había cargado, se recarga; si no, la próxima carga ya lo trae.
  useEffect(() => {
    const sucio = () => {
      if (estadoRef.current !== 'inactivo') void cargar();
    };
    window.addEventListener(EVENTO_INDICE_SUCIO, sucio);
    return () => window.removeEventListener(EVENTO_INDICE_SUCIO, sucio);
  }, [cargar]);

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
  const visible = abierto && resultados.length > 0;
  // Siempre dentro de rango aunque los resultados cambien (p. ej. 0 resultados).
  const sel = Math.max(0, Math.min(activo, resultados.length - 1));
  const idActivo = visible ? `${id}-op-${sel}` : undefined;

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
        aria-controls={`${id}-lista`}
        aria-activedescendant={idActivo}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Buscar pieza, cliente o vendedor ( / )"
        value={q}
        onFocus={() => {
          asegurarCarga();
          setRecientes(leerRecientes());
          setAbierto(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setActivo(0);
          setAbierto(true);
        }}
        onClick={() => setAbierto(true)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!abierto) setAbierto(true);
            else setActivo(Math.min(sel + 1, resultados.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActivo(Math.max(sel - 1, 0));
          } else if (e.key === 'Enter' && visible && resultados[sel]) {
            e.preventDefault();
            abrir(resultados[sel]);
          } else if (e.key === 'Escape') {
            setAbierto(false);
          }
        }}
        onBlur={() => setAbierto(false)}
        className="min-h-11 w-full rounded-lg border border-borde-campo bg-white px-3"
      />
      <div
        role="status"
        aria-live="polite"
        className={aviso && !visible ? 'mt-1 text-xs text-tinta-suave' : 'sr-only'}
      >
        {aviso}
      </div>
      <ul
        id={`${id}-lista`}
        role="listbox"
        aria-label="Resultados"
        hidden={!visible}
        className="absolute inset-x-4 z-10 mt-1 overflow-hidden md:inset-x-auto md:w-full rounded-lg border border-borde bg-white shadow"
      >
        {visible &&
          resultados.map((r, i) => (
            <li
              key={r.clave}
              id={`${id}-op-${i}`}
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
                      className="size-10 shrink-0 rounded border border-borde bg-white object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="size-10 shrink-0 rounded border border-borde bg-white"
                    />
                  ))}
                <span className="min-w-0">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                    {ETIQUETA_TIPO[r.tipo]}
                  </span>
                  <span className="block text-sm font-medium">{r.titulo}</span>
                  <span className="block text-xs text-tinta-suave">{r.subtitulo}</span>
                </span>
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
