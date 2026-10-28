'use client';

import { useContext, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { CampoFecha } from './CampoFecha';
import { ErroresCampo } from './errores-campo';
import { Seleccion } from './Seleccion';

/** Vocabulario único de campos (utilidad `campo` de globals.css): reposo, hover, foco, deshabilitado, solo lectura y error. */
export const ESTILO = 'campo';
export const ESTILO_ETIQUETA = 'text-meta font-medium';

/** Error de un campo: fuera del `<label>` para que no forme parte del nombre accesible del control. */
export function MensajeError({ idControl, error }: { idControl: string; error?: string }) {
  if (!error) return null;
  return (
    <span id={`${idControl}-error`} className="mensaje-error text-meta font-normal text-error">
      {error}
    </span>
  );
}

/** El id del mensaje deriva del id del control (único por useId), no del name: dos formularios pueden repetir name. */
export function useErrorDe(name: string, idControl: string) {
  const error = useContext(ErroresCampo)[name];
  return {
    error,
    aria: {
      'aria-invalid': error ? (true as const) : undefined,
      'aria-describedby': error ? `${idControl}-error` : undefined,
    },
  };
}

export function Campo({
  etiqueta,
  id,
  ...props
}: { etiqueta: string; name: string } & InputHTMLAttributes<HTMLInputElement>) {
  const propio = useId();
  const idControl = id ?? propio;
  const { error, aria } = useErrorDe(props.name, idControl);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={idControl} className={ESTILO_ETIQUETA}>
        {etiqueta}
      </label>
      {props.type === 'date' ? (
        // Fecha «mixto»: nativa en celular, dd/mm/aaaa con calendario en escritorio. Envía aaaa-mm-dd como siempre.
        <CampoFecha
          id={idControl}
          name={props.name}
          etiqueta={etiqueta}
          defaultValue={props.defaultValue === undefined ? '' : String(props.defaultValue)}
          min={props.min === undefined ? undefined : String(props.min)}
          max={props.max === undefined ? undefined : String(props.max)}
          required={props.required}
          disabled={props.disabled}
          readOnly={props.readOnly}
          {...aria}
        />
      ) : (
        <input id={idControl} className={ESTILO} {...aria} {...props} />
      )}
      <MensajeError idControl={idControl} error={error} />
    </div>
  );
}

export function Selector({
  etiqueta,
  name,
  opciones,
  defaultValue,
  required,
  value,
  onChange,
}: {
  etiqueta: string;
  name: string;
  opciones: readonly { valor: string; texto: string }[];
  defaultValue?: string;
  required?: boolean;
  /** Controlado (opcional): úsalo con `onChange`, no con `defaultValue`. */
  value?: string;
  onChange?: (valor: string) => void;
}) {
  const id = useId();
  const { error, aria } = useErrorDe(name, id);
  return (
    <div className="flex flex-col gap-1">
      {/* htmlFor/id y no label envolvente: así el nombre accesible es solo la etiqueta, sin el texto de las opciones. */}
      <label htmlFor={id} className={ESTILO_ETIQUETA}>
        {etiqueta}
      </label>
      <Seleccion
        id={id}
        name={name}
        opciones={opciones}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange}
        required={required}
        {...aria}
      />
      <MensajeError idControl={id} error={error} />
    </div>
  );
}

export function AreaTexto({
  etiqueta,
  name,
  rows = 4,
  defaultValue,
  required,
  placeholder,
  maxLength,
  onChange,
}: {
  etiqueta: string;
  name: string;
  rows?: number;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  onChange?: (valor: string) => void;
}) {
  const id = useId();
  const { error, aria } = useErrorDe(name, id);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={ESTILO_ETIQUETA}>
        {etiqueta}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={onChange && ((e) => onChange(e.target.value))}
        className="campo py-2 font-mono"
        {...aria}
      />
      <MensajeError idControl={id} error={error} />
    </div>
  );
}

/**
 * Casilla de verificación: caja propia con la palomita que se dibuja (receta «checkbox» de transitions.dev) sobre
 * un `<input type="checkbox">` nativo, así que `required`, FormData y el teclado funcionan como siempre. La fila
 * mide 44 px de alto y todo el renglón es el objetivo táctil. El error del servidor se pinta bajo la casilla.
 */
export function CampoCasilla({
  name,
  children,
  ...props
}: { name: string; children: ReactNode } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'id' | 'name'
>) {
  const id = useId();
  const { error, aria } = useErrorDe(name, id);
  return (
    <div className="flex flex-col gap-1">
      <label className="casilla-fila text-dato">
        <span className="casilla-caja">
          <input id={id} type="checkbox" name={name} {...aria} {...props} />
          <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12">
            <path d="M2 6.4 4.8 9 10 3.2" />
          </svg>
        </span>
        <span>{children}</span>
      </label>
      <MensajeError idControl={id} error={error} />
    </div>
  );
}
