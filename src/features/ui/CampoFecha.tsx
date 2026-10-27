'use client';

import * as Popover from '@radix-ui/react-popover';
import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { es } from 'react-day-picker/locale/es';
import { hoyMX } from '@/domain/fechas';
import { useEscritorio } from './escritorio';
import {
  dateAIso,
  enmascararFecha,
  errorDeFecha,
  isoADate,
  isoAVista,
  normalizarVista,
  vistaAIso,
} from './fecha-campo';
import { useAlReiniciarFormulario } from './Seleccion';

interface AriaCampo {
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/**
 * Campo de fecha de la app (decisión «mixto»):
 *  - Celular o pantalla chica (servidor y primer pintado): `<input type="date">` nativo con el aspecto Kazero.
 *  - Escritorio (puntero fino y ≥1024 px, tras montar): se escribe dd/mm/aaaa (con máscara) o se elige en un
 *    calendario (react-day-picker, español, semana desde el lunes).
 * El formulario siempre envía `name` = aaaa-mm-dd (en escritorio lo lleva un `<input hidden>`).
 */
export function CampoFecha({
  id,
  name,
  etiqueta,
  defaultValue = '',
  min,
  max,
  required,
  disabled,
  readOnly,
  className = '',
  ...aria
}: {
  id: string;
  name: string;
  /** Nombre del campo, para el título accesible del calendario. */
  etiqueta: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
} & AriaCampo) {
  const escritorio = useEscritorio();
  // Fuente de verdad: la fecha ISO ('' = vacía). El texto escrito en escritorio se deriva de ella al terminar.
  const [iso, setIso] = useState(defaultValue);
  // Un reinicio del formulario cambia la `key` del campo de escritorio: su texto vuelve a derivarse de `iso`.
  const [reinicios, setReinicios] = useState(0);
  const ancla = useRef<HTMLSpanElement>(null);
  useAlReiniciarFormulario(ancla, () => {
    setIso(defaultValue);
    setReinicios((n) => n + 1);
  });

  return (
    <>
      <span ref={ancla} hidden />
      {escritorio ? (
        <FechaEscritorio
          key={reinicios}
          id={id}
          name={name}
          etiqueta={etiqueta}
          iso={iso}
          alCambiar={setIso}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          className={className}
          {...aria}
        />
      ) : (
        <input
          id={id}
          name={name}
          type="date"
          value={iso}
          onChange={(e) => setIso(e.target.value)}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          className={`campo ${className}`}
          {...aria}
        />
      )}
    </>
  );
}

function IconoCalendario() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
      <path d="M3 8.5h14M7 2.8v3M13 2.8v3" />
    </svg>
  );
}

function FechaEscritorio({
  id,
  name,
  etiqueta,
  iso,
  alCambiar,
  min,
  max,
  required,
  disabled,
  readOnly,
  className,
  ...aria
}: {
  id: string;
  name: string;
  etiqueta: string;
  iso: string;
  alCambiar: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className: string;
} & AriaCampo) {
  const entrada = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState(isoAVista(iso));
  const [abierto, setAbierto] = useState(false);
  const bloqueado = disabled || readOnly;

  // El navegador valida con esto al enviar: fecha incompleta, inexistente o fuera de rango.
  useEffect(() => {
    entrada.current?.setCustomValidity(errorDeFecha(texto, min, max));
  }, [texto, min, max]);

  const hoy = hoyMX();
  const seleccionada = isoADate(iso);
  const minimo = min ? isoADate(min) : undefined;
  const maximo = max ? isoADate(max) : undefined;
  const hoyEnRango = (!min || hoy >= min) && (!max || hoy <= max);

  function elegir(nuevo: string) {
    alCambiar(nuevo);
    setTexto(isoAVista(nuevo));
    setAbierto(false);
    entrada.current?.focus();
  }

  return (
    <Popover.Root open={abierto} onOpenChange={setAbierto}>
      <div className="relative">
        <input
          ref={entrada}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/aaaa"
          maxLength={10}
          value={texto}
          onChange={(e) => {
            const t = enmascararFecha(e.target.value);
            setTexto(t);
            alCambiar(vistaAIso(t) ?? '');
          }}
          onBlur={() => setTexto((t) => normalizarVista(t))}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          className={`campo pe-12 tabular-nums ${className}`}
          {...aria}
        />
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={bloqueado}
            aria-label="Abrir calendario"
            className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-lg text-secundario transition-colors hover:text-secundario-fuerte disabled:opacity-60"
          >
            <IconoCalendario />
          </button>
        </Popover.Trigger>
        {/* Lo que se envía: el ISO (el campo visible no lleva name). */}
        <input type="hidden" name={name} value={iso} disabled={disabled} />
      </div>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={`Calendario: ${etiqueta}`}
          className="menu-flotante p-3"
          // Al cerrar con Escape o al elegir, el foco vuelve al campo de texto, no al botón del calendario.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            entrada.current?.focus();
          }}
        >
          <DayPicker
            mode="single"
            locale={es}
            weekStartsOn={1}
            className="calendario"
            selected={seleccionada}
            defaultMonth={seleccionada ?? maximo ?? undefined}
            disabled={[...(minimo ? [{ before: minimo }] : []), ...(maximo ? [{ after: maximo }] : [])]}
            onSelect={(d) => d && elegir(dateAIso(d))}
            autoFocus
            required
          />
          <div className="mt-2 flex justify-between border-t border-borde pt-2">
            <button
              type="button"
              disabled={!hoyEnRango}
              onClick={() => elegir(hoy)}
              className="boton-texto min-h-10 text-secundario"
            >
              Hoy
            </button>
            {!required && iso && (
              <button
                type="button"
                onClick={() => {
                  alCambiar('');
                  setTexto('');
                  setAbierto(false);
                  entrada.current?.focus();
                }}
                className="boton-texto min-h-10"
              >
                Quitar fecha
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
