'use client';

import { useContext, useId, useMemo, useRef, useState } from 'react';
import { accionClienteRapido } from '@/app/panel/pedidos/acciones';
import { normalizar } from '@/domain/texto';
import { ErroresCampo } from '@/features/ui/errores-campo';
import { unaALaVez } from '@/features/ui/una-a-la-vez';
import { crearMotor } from '@/search/motor';
import { marcarIndiceSucio } from '@/search/eventos';
import { useIndiceBusqueda } from '@/search/useIndiceBusqueda';

export interface ClienteElegido {
  id: string;
  nombre: string;
}

interface Opcion {
  clave: string;
  titulo: string;
  subtitulo: string;
  /** Presente en las opciones de clientes existentes; ausente en "Crear cliente". */
  id?: string;
}

/** Combobox de cliente con alta en línea (spec §8): no saca al usuario de la pantalla del pedido. */
export function SelectorCliente({
  inicial,
  onElegir,
}: {
  inicial: ClienteElegido | null;
  onElegir: (c: ClienteElegido | null) => void;
}) {
  const id = useId();
  const errores = useContext(ErroresCampo);
  const errorCampo = errores.clienteId;
  const { indice, asegurarCarga } = useIndiceBusqueda();
  const [q, setQ] = useState(inicial?.nombre ?? '');
  const [elegido, setElegido] = useState<ClienteElegido | null>(inicial);
  const [activo, setActivo] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [creando, setCreando] = useState(false);
  const [errorAlta, setErrorAlta] = useState('');
  // Un doble clic (o Enter repetido) antes de re-renderizar no debe crear dos clientes: el guardián es síncrono.
  const altaRapida = useRef(unaALaVez(accionClienteRapido));

  const motor = useMemo(() => (indice ? crearMotor(indice) : null), [indice]);
  const limpio = q.trim().replace(/\s+/g, ' ');
  const opciones = useMemo<Opcion[]>(() => {
    if (!limpio || elegido) return [];
    const encontrados: Opcion[] = motor
      ? motor.buscar(limpio, [], 8, { tipos: ['cliente'] }).map((r) => ({
          clave: r.clave,
          titulo: r.titulo,
          subtitulo: r.subtitulo,
          id: r.clave.slice('cliente:'.length),
        }))
      : [];
    const exacto = encontrados.some((o) => normalizar(o.titulo) === normalizar(limpio));
    return exacto
      ? encontrados
      : [...encontrados, { clave: 'crear', titulo: `Crear cliente «${limpio}»`, subtitulo: 'Cliente nuevo' }];
  }, [motor, limpio, elegido]);

  const visible = abierto && opciones.length > 0;
  const sel = Math.max(0, Math.min(activo, opciones.length - 1));

  function elegir(c: ClienteElegido) {
    setElegido(c);
    setQ(c.nombre);
    setAbierto(false);
    setErrorAlta('');
    onElegir(c);
  }

  async function crear() {
    if (creando) return;
    setCreando(true);
    setErrorAlta('');
    try {
      const r = await altaRapida.current(limpio);
      if (r.error || !r.id) {
        setErrorAlta(r.error ?? 'No se pudo crear el cliente. Intenta de nuevo.');
        return;
      }
      marcarIndiceSucio();
      elegir({ id: r.id, nombre: r.nombre ?? limpio });
    } catch {
      setErrorAlta('No se pudo crear el cliente. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setCreando(false);
    }
  }

  function aceptar(o: Opcion) {
    if (o.id) elegir({ id: o.id, nombre: o.titulo });
    else void crear();
  }

  const mensaje = errorAlta || errorCampo;
  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={`${id}-q`} className="text-meta font-medium">
        Cliente
      </label>
      <input type="hidden" name="clienteId" value={elegido?.id ?? ''} />
      <input
        id={`${id}-q`}
        type="text"
        role="combobox"
        aria-expanded={visible}
        aria-controls={`${id}-lista`}
        aria-activedescendant={visible ? `${id}-op-${sel}` : undefined}
        aria-autocomplete="list"
        aria-invalid={mensaje ? true : undefined}
        aria-describedby={mensaje ? `${id}-error` : undefined}
        autoComplete="off"
        maxLength={120}
        value={q}
        onFocus={() => {
          asegurarCarga();
          setAbierto(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setActivo(0);
          setAbierto(true);
          setErrorAlta('');
          if (elegido) {
            setElegido(null);
            onElegir(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!abierto) setAbierto(true);
            else setActivo(Math.min(sel + 1, opciones.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActivo(Math.max(sel - 1, 0));
          } else if (e.key === 'Enter') {
            // Enter nunca envía el pedido desde aquí: solo elige.
            e.preventDefault();
            if (visible && opciones[sel]) aceptar(opciones[sel]);
          } else if (e.key === 'Escape') {
            setAbierto(false);
          }
        }}
        onBlur={() => setAbierto(false)}
        className="campo"
      />
      <ul
        id={`${id}-lista`}
        role="listbox"
        aria-label="Clientes"
        hidden={!visible}
        className="lista-combo absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-borde bg-white shadow"
      >
        {visible &&
          opciones.map((o, i) => (
            <li
              key={o.clave}
              id={`${id}-op-${i}`}
              role="option"
              aria-selected={i === sel}
              onMouseMove={() => setActivo(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                aceptar(o);
              }}
              className={`min-h-11 cursor-pointer px-3 py-2 ${i === sel ? 'bg-rubor-suave' : ''}`}
            >
              <span className="block text-dato font-medium">{o.titulo}</span>
              <span className="block text-meta text-tinta-suave">{o.subtitulo}</span>
            </li>
          ))}
      </ul>
      {mensaje && (
        <span
          id={`${id}-error`}
          role={errorAlta ? 'alert' : undefined}
          className="text-meta font-normal text-error"
        >
          {mensaje}
        </span>
      )}
      {/* Siempre montado: una región que nace con texto no se anuncia. */}
      <p role="status" className="sr-only">
        {creando ? 'Creando cliente…' : ''}
      </p>
    </div>
  );
}
