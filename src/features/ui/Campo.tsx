import type { InputHTMLAttributes } from 'react';

const ESTILO = 'min-h-11 rounded-lg border border-stone-300 px-3';

export function Campo({
  etiqueta,
  ...props
}: { etiqueta: string; name: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {etiqueta}
      <input className={ESTILO} {...props} />
    </label>
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
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {etiqueta}
      <select name={name} defaultValue={defaultValue} required={required} className={ESTILO}>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </label>
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
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {etiqueta}
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        className="rounded-lg border border-stone-300 px-3 py-2 font-mono"
      />
    </label>
  );
}
