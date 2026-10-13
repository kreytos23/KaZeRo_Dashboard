'use client';

import { useContext, useId, type InputHTMLAttributes } from 'react';
import { ErroresCampo } from './errores-campo';

export const ESTILO =
  'min-h-11 rounded-lg border border-borde-campo bg-white px-3 aria-invalid:border-2 aria-invalid:border-error';
export const ESTILO_ETIQUETA = 'text-sm font-medium';

/** Error de un campo: fuera del `<label>` para que no forme parte del nombre accesible del control. */
export function MensajeError({ idControl, error }: { idControl: string; error?: string }) {
  if (!error) return null;
  return (
    <span id={`${idControl}-error`} className="text-sm font-normal text-error">
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
      <label htmlFor={id ?? propio} className={ESTILO_ETIQUETA}>
        {etiqueta}
      </label>
      <input id={id ?? propio} className={ESTILO} {...aria} {...props} />
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
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        required={required}
        className={ESTILO}
        {...aria}
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
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
}: {
  etiqueta: string;
  name: string;
  rows?: number;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
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
        className="rounded-lg border border-borde-campo bg-white px-3 py-2 font-mono aria-invalid:border-2 aria-invalid:border-error"
        {...aria}
      />
      <MensajeError idControl={id} error={error} />
    </div>
  );
}
