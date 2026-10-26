'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { SelectorFoto } from '@/features/imagenes/SelectorFoto';
import { ErroresCampo, useEnfocarPrimerInvalido } from '@/features/ui/errores-campo';
import type { EstadoAccion } from '@/features/ui/estado';
import { BotonEnvio } from '@/features/ui/FormAccion';
import { useHidratado } from '@/features/ui/hidratado';
import { marcarIndiceSucio } from '@/search/eventos';
import { accionCambiarImagen } from '../acciones';
import { textoBotonFoto } from '../etiquetas';

export function FormFoto({
  piezaId,
  version,
  tieneFoto,
}: {
  piezaId: string;
  version: number;
  tieneFoto: boolean;
}) {
  const [estado, despachar, pendiente] = useActionState<EstadoAccion, FormData>(accionCambiarImagen, {});
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vuelta, setVuelta] = useState(0); // key del selector: se reinicia tras guardar
  const form = useRef<HTMLFormElement>(null);
  const hidratado = useHidratado();
  useEnfocarPrimerInvalido(form, estado);

  // Tras guardar, se reinicia el selector (ajuste de estado durante el render, sin efecto en cascada).
  const [procesado, setProcesado] = useState(estado);
  if (estado !== procesado) {
    setProcesado(estado);
    if (estado.ok) {
      setArchivo(null);
      setVuelta((v) => v + 1);
    }
  }

  useEffect(() => {
    if (estado.ok) marcarIndiceSucio();
  }, [estado]);

  return (
    <form
      ref={form}
      method="post"
      data-hidratado={hidratado ? 'si' : 'no'}
      aria-busy={pendiente}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pendiente || !archivo) return;
        const datos = new FormData(e.currentTarget);
        datos.set('imagen', archivo);
        startTransition(() => despachar(datos));
      }}
    >
      <input type="hidden" name="piezaId" value={piezaId} />
      <input type="hidden" name="version" value={version} />
      <ErroresCampo.Provider value={estado.campos ?? {}}>
        <SelectorFoto key={vuelta} etiqueta={tieneFoto ? 'Nueva foto' : 'Foto'} onCambio={setArchivo} />
      </ErroresCampo.Provider>
      {estado.error && !estado.campos && (
        <p role="alert" className="aviso-error">
          {estado.error}
        </p>
      )}
      <p role="status" className={estado.ok ? 'aviso-exito' : undefined}>
        {pendiente ? 'Subiendo…' : estado.ok}
      </p>
      <BotonEnvio
        textoBoton={textoBotonFoto(tieneFoto)}
        pendiente={pendiente}
        hidratado={hidratado}
        deshabilitado={!archivo}
      />
    </form>
  );
}
