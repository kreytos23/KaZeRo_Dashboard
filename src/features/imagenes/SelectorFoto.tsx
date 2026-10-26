'use client';

import { useContext, useEffect, useId, useState } from 'react';
import { ErroresCampo } from '@/features/ui/errores-campo';
import { prepararFoto } from './preparar';

const BOTON =
  'flex min-h-11 cursor-pointer items-center rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-secundario';

/**
 * Dos controles: "Tomar foto" abre la cámara (capture) y "Elegir foto" la galería (sin capture: en Android,
 * capture no deja elegir de la galería). Los inputs NO tienen `name`: el formulario envía el archivo ya
 * preparado (onCambio), nunca el original de 3–12 MB.
 */
export function SelectorFoto({
  etiqueta,
  onCambio,
}: {
  etiqueta: string;
  onCambio: (f: File | null) => void;
}) {
  const id = useId();
  const errorServidor = useContext(ErroresCampo).imagen;
  const [vista, setVista] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mensaje = error ?? errorServidor;

  // Libera la vista previa anterior (y al desmontar: "Guardar y agregar otra" cambia la key).
  useEffect(() => () => void (vista && URL.revokeObjectURL(vista)), [vista]);

  async function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const original = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!original) return;
    setPreparando(true);
    setError(null);
    try {
      const lista = await prepararFoto(original);
      setVista(URL.createObjectURL(lista));
      onCambio(lista);
    } catch (err) {
      setVista(null);
      onCambio(null);
      setError(err instanceof Error ? err.message : 'No se pudo leer la foto.');
    } finally {
      setPreparando(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={mensaje ? `${id}-error` : undefined}>
      <legend className="text-meta font-medium">{etiqueta}</legend>
      <div className="flex flex-wrap gap-2">
        <label className={BOTON}>
          Tomar foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={elegir}
            aria-invalid={mensaje ? true : undefined}
          />
        </label>
        <label className={BOTON}>
          Elegir foto
          <input type="file" accept="image/*" className="sr-only" onChange={elegir} />
        </label>
      </div>
      <p role="status" className="text-meta text-tinta-suave">
        {preparando ? 'Preparando foto…' : ''}
      </p>
      {vista && (
        // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:), no pasa por el optimizador
        <img
          src={vista}
          alt="Vista previa de la foto"
          width={160}
          height={160}
          className="aspect-square w-40 rounded-lg border border-borde bg-white object-contain"
        />
      )}
      {mensaje && (
        <span id={`${id}-error`} className="text-meta text-error">
          {mensaje}
        </span>
      )}
    </fieldset>
  );
}
