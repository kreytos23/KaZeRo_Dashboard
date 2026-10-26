'use client';

import * as Select from '@radix-ui/react-select';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscritorio } from './escritorio';

export interface OpcionSeleccion {
  valor: string;
  texto: string;
}

/** Radix no admite `value=""` en una opción (lo reserva para «sin selección»): la opción vacía usa este valor interno. */
const VACIO = '__vacio__';

function Chevron({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5.5 8l4.5 4.5L14.5 8" />
    </svg>
  );
}

/**
 * Restaura el valor inicial cuando el formulario se reinicia (`form.reset()` tras guardar con `limpiarAlGuardar`):
 * el estado de React no se entera del reinicio nativo.
 */
export function useAlReiniciarFormulario(ancla: { current: HTMLElement | null }, restaurar: () => void) {
  const ultima = useRef(restaurar);
  useEffect(() => {
    ultima.current = restaurar;
  });
  useEffect(() => {
    const form = ancla.current?.closest('form');
    if (!form) return;
    // El evento llega antes de que el navegador reinicie los campos: se restaura en el turno siguiente.
    const alReiniciar = () => setTimeout(() => ultima.current(), 0);
    form.addEventListener('reset', alReiniciar);
    return () => form.removeEventListener('reset', alReiniciar);
  }, [ancla]);
}

/**
 * Select de la app. Un solo componente con dos caras (decisión «mixto»):
 *  - Celular o pantalla chica (primer pintado y servidor): `<select>` nativo con el aspecto Kazero; abre el
 *    selector del teléfono.
 *  - Escritorio (puntero fino y ≥1024 px, tras montar): listbox de Radix con teclado completo y animación.
 * En ambos casos el formulario envía lo mismo: `name` → valor (el de escritorio lo lleva un `<input hidden>`).
 */
export function Seleccion({
  id,
  name,
  opciones,
  value,
  defaultValue,
  onChange,
  required,
  disabled,
  className = '',
  ...aria
}: {
  id: string;
  name: string;
  opciones: readonly OpcionSeleccion[];
  value?: string;
  defaultValue?: string;
  onChange?: (valor: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}) {
  const escritorio = useEscritorio();
  const inicial = defaultValue ?? opciones[0]?.valor ?? '';
  const [interno, setInterno] = useState(inicial);
  const valor = value ?? interno;
  const ancla = useRef<HTMLSpanElement>(null);
  useAlReiniciarFormulario(ancla, () => {
    setInterno(inicial);
    if (value !== undefined) onChange?.(inicial);
  });

  const cambiar = useCallback(
    (nuevo: string) => {
      setInterno(nuevo);
      onChange?.(nuevo);
    },
    [onChange],
  );

  return (
    <>
      {/* Ancla invisible para localizar el formulario (el control cambia de elemento al pasar a escritorio). */}
      <span ref={ancla} hidden />
      {escritorio ? (
        <>
          <Select.Root
            value={valor === '' ? VACIO : valor}
            onValueChange={(v) => cambiar(v === VACIO ? '' : v)}
            disabled={disabled}
          >
            <Select.Trigger
              id={id}
              aria-required={required || undefined}
              className={`campo campo-disparador ${className}`}
              {...aria}
            >
              <Select.Value />
              <Select.Icon asChild>
                <Chevron className="chevron" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                position="popper"
                sideOffset={6}
                collisionPadding={12}
                className="menu-flotante menu-select"
              >
                <Select.Viewport>
                  {opciones.map((o) => (
                    <Select.Item
                      key={o.valor}
                      value={o.valor === '' ? VACIO : o.valor}
                      className="opcion-menu"
                    >
                      <Select.ItemText>{o.texto}</Select.ItemText>
                      <Select.ItemIndicator className="marca">
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 10.5l4 4 8-9" />
                        </svg>
                      </Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          <input type="hidden" name={name} value={valor} disabled={disabled} />
        </>
      ) : (
        <select
          id={id}
          name={name}
          value={valor}
          onChange={(e) => cambiar(e.target.value)}
          required={required}
          disabled={disabled}
          className={`campo campo-select ${className}`}
          {...aria}
        >
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
