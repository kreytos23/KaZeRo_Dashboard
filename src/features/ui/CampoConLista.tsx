'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { ESTILO_ETIQUETA, MensajeError, useErrorDe } from './Campo';
import { filtrarOpciones } from './filtrar-opciones';
import { useCombobox } from './useCombobox';

interface Opcion {
  texto: string;
  nueva: boolean;
}

/**
 * Combobox accesible (WAI-ARIA 1.2, listbox) para campos de catálogo (categoría, material, proveedor):
 * muestra los existentes —también con la flecha visible, que en celular sí se toca— y deja escribir uno nuevo
 * ("Agregar «…»"). El valor se envía tal cual en `name`; el servidor lo crea si no existe (resolverCatalogos).
 */
export function CampoConLista({
  etiqueta,
  name,
  opciones,
  required,
  maxLength,
  defaultValue = '',
  textoNuevo = 'Agregar',
  placeholder,
}: {
  etiqueta: string;
  name: string;
  opciones: readonly string[];
  required?: boolean;
  maxLength?: number;
  defaultValue?: string;
  textoNuevo?: string;
  placeholder?: string;
}) {
  const id = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState(defaultValue);
  const [abierto, setAbierto] = useState(false);
  // Al enfocar o tocar la flecha se ve la lista completa; al escribir se filtra.
  const [filtrando, setFiltrando] = useState(false);
  const { error, aria } = useErrorDe(name, id);

  const lista = useMemo<Opcion[]>(() => {
    const f = filtrarOpciones(opciones, filtrando ? texto : '');
    const todas: Opcion[] = f.opciones.map((o) => ({ texto: o, nueva: false }));
    const limpio = texto.trim();
    if (limpio && !filtrarOpciones(opciones, limpio).exacta) todas.push({ texto: limpio, nueva: true });
    return todas;
  }, [opciones, texto, filtrando]);

  function elegir(i: number) {
    const o = lista[i];
    if (!o) return;
    setTexto(o.texto);
    setFiltrando(false);
    setAbierto(false);
  }

  const cb = useCombobox({
    id,
    cantidad: lista.length,
    abierto,
    setAbierto,
    alElegir: elegir,
    activoInicial: -1,
  });

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-q`} className={ESTILO_ETIQUETA}>
        {etiqueta}
      </label>
      <div className="relative flex rounded-lg border border-borde-campo bg-superficie focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primario has-[input[aria-expanded=true]]:rounded-b-none has-[input[aria-invalid=true]]:border-error has-[input[aria-invalid=true]]:shadow-[inset_0_0_0_1px_var(--color-error)]">
        <input
          id={`${id}-q`}
          ref={entrada}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={cb.visible}
          aria-controls={cb.idLista}
          aria-activedescendant={cb.idActivo}
          aria-autocomplete="list"
          autoComplete="off"
          required={required}
          maxLength={maxLength}
          placeholder={placeholder}
          value={texto}
          onFocus={() => {
            setFiltrando(false);
            // En pantallas táctiles la lista abierta taparía el teclado y el formulario: allí se abre al
            // escribir, con las flechas o con la flecha visible.
            if (!window.matchMedia('(pointer: coarse)').matches) setAbierto(true);
          }}
          onChange={(e) => {
            setTexto(e.target.value);
            setFiltrando(true);
            cb.reiniciar();
            setAbierto(true);
          }}
          onClick={() => {
            if (!window.matchMedia('(pointer: coarse)').matches) setAbierto(true);
          }}
          onKeyDown={cb.onKeyDown}
          // Tab (o tocar fuera) cierra y acepta lo escrito tal cual.
          onBlur={() => setAbierto(false)}
          className="min-h-11 min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-tinta outline-none"
          {...aria}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Mostrar opciones de ${etiqueta}`}
          aria-expanded={cb.visible}
          aria-controls={cb.idLista}
          // Evita que el campo pierda el foco (y cierre la lista) antes del clic.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (abierto) {
              setAbierto(false);
              return;
            }
            setFiltrando(false);
            setAbierto(true);
            entrada.current?.focus();
          }}
          className="flex min-h-11 w-11 cursor-pointer items-center justify-center rounded-r-lg text-secundario hover:bg-secundario-suave"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
            <path d="M5.5 7.5 10 12l4.5-4.5z" />
          </svg>
        </button>
        <ul
          id={cb.idLista}
          role="listbox"
          // Con muchas opciones la lista hace scroll y Chrome la volvería una parada de Tab: al salir del campo
          // se cierra y el foco se perdería. El teclado la maneja desde el campo (aria-activedescendant).
          tabIndex={-1}
          aria-label={`Opciones de ${etiqueta}`}
          hidden={!cb.visible}
          className="lista-combo absolute inset-x-0 top-full max-h-60 overflow-auto rounded-b-lg border border-t-0 border-borde-campo bg-superficie shadow"
        >
          {cb.visible &&
            lista.map((o, i) => (
              <li
                key={`${o.nueva ? 'n' : 'o'}:${o.texto}`}
                id={cb.idOpcion(i)}
                role="option"
                aria-selected={i === cb.sel}
                onMouseMove={() => cb.setActivo(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(i);
                }}
                className={`flex min-h-11 cursor-pointer items-center px-3 py-2 ${o.nueva ? 'font-medium text-secundario' : ''} ${i === cb.sel ? 'bg-rubor-suave' : ''}`}
              >
                {o.nueva ? `${textoNuevo} «${o.texto}»` : o.texto}
              </li>
            ))}
        </ul>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {cb.visible ? (lista.length === 1 ? '1 opción' : `${lista.length} opciones`) : ''}
      </div>
      <MensajeError idControl={id} error={error} />
    </div>
  );
}
