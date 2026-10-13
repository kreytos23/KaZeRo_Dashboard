'use client';

import { useId, useMemo, useState } from 'react';
import { crearMotor } from '@/search/motor';
import { useIndiceBusqueda } from '@/search/useIndiceBusqueda';

/** Alternativa a teclear el código: busca por código o descripción y agrega la pieza elegida. */
export function BuscarPieza({ onElegir }: { onElegir: (codigo: string) => void }) {
  const id = useId();
  const { indice, asegurarCarga } = useIndiceBusqueda();
  const [q, setQ] = useState('');
  const [activo, setActivo] = useState(0);
  const [abierto, setAbierto] = useState(false);

  const motor = useMemo(() => (indice ? crearMotor(indice) : null), [indice]);
  const resultados = useMemo(
    () => (motor && q.trim() ? motor.buscar(q, [], 8, { tipos: ['pieza'] }) : []),
    [motor, q],
  );
  const visible = abierto && resultados.length > 0;
  const sel = Math.max(0, Math.min(activo, resultados.length - 1));

  function elegir(titulo: string) {
    // El título es "CÓDIGO · descripción" (ver motor): el código no contiene ese separador.
    onElegir(titulo.split(' · ')[0]!);
    setQ('');
    setAbierto(false);
  }

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={`${id}-q`} className="text-sm font-medium">
        Buscar pieza
      </label>
      <input
        id={`${id}-q`}
        type="text"
        role="combobox"
        aria-expanded={visible}
        aria-controls={`${id}-lista`}
        aria-activedescendant={visible ? `${id}-op-${sel}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Código o descripción"
        value={q}
        onFocus={() => {
          asegurarCarga();
          setAbierto(true);
        }}
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
            e.preventDefault();
            if (visible && resultados[sel]) elegir(resultados[sel].titulo);
          } else if (e.key === 'Escape') {
            setAbierto(false);
          }
        }}
        onBlur={() => setAbierto(false)}
        className="min-h-11 rounded-lg border border-borde-campo bg-white px-3"
      />
      <ul
        id={`${id}-lista`}
        role="listbox"
        aria-label="Piezas encontradas"
        hidden={!visible}
        className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-borde bg-white shadow"
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
                elegir(r.titulo);
              }}
              className={`min-h-11 cursor-pointer px-3 py-2 ${i === sel ? 'bg-rubor-suave' : ''}`}
            >
              <span className="block text-sm font-medium">{r.titulo}</span>
              <span className="block text-xs text-tinta-suave">{r.subtitulo}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
