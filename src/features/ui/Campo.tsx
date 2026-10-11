'use client';

import { useContext, useId, type InputHTMLAttributes } from 'react';
import { ErroresCampo } from './errores-campo';

const ESTILO = 'min-h-11 rounded-lg border border-stone-300 px-3';
const ESTILO_ETIQUETA = 'text-sm font-medium';

/** Error de un campo: fuera del `<label>` para que no forme parte del nombre accesible del control. */
function MensajeError({ name, error }: { name: string; error?: string }) {
  if (!error) return null;
  return (
    <span id={`${name}-error`} className="text-sm font-normal text-red-700">
      {error}
    </span>
  );
}

function useErrorDe(name: string) {
  const error = useContext(ErroresCampo)[name];
  return {
    error,
    aria: {
      'aria-invalid': error ? (true as const) : undefined,
      'aria-describedby': error ? `${name}-error` : undefined,
    },
  };
}

export function Campo({
  etiqueta,
  id,
  ...props
}: { etiqueta: string; name: string } & InputHTMLAttributes<HTMLInputElement>) {
  const propio = useId();
  const { error, aria } = useErrorDe(props.name);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id ?? propio} className={ESTILO_ETIQUETA}>
        {etiqueta}
      </label>
      <input id={id ?? propio} className={ESTILO} {...aria} {...props} />
      <MensajeError name={props.name} error={error} />
    </div>
  );
}

export function Selector({
  etiqueta,
  name,
  opciones,
  defaultValue,
  required,
}: {
  etiqueta: string;
  name: string;
  opciones: readonly { valor: string; texto: string }[];
  defaultValue?: string;
  required?: boolean;
}) {
  const id = useId();
  const { error, aria } = useErrorDe(name);
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
      <MensajeError name={name} error={error} />
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
  const { error, aria } = useErrorDe(name);
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
        className="rounded-lg border border-stone-300 px-3 py-2 font-mono"
        {...aria}
      />
      <MensajeError name={name} error={error} />
    </div>
  );
}
