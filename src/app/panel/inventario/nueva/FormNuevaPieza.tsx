'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { Campo } from '@/features/ui/Campo';
import { ErroresCampo, useEnfocarPrimerInvalido } from '@/features/ui/errores-campo';
import type { EstadoAccion } from '@/features/ui/estado';
import { useHidratado } from '@/features/ui/hidratado';
import { marcarIndiceSucio } from '@/search/eventos';
import { accionAltaPieza, accionSugerirCodigo } from '../acciones';

export function FormNuevaPieza({ categorias }: { categorias: string[] }) {
  const router = useRouter();
  const [estado, despachar, pendiente] = useActionState<EstadoAccion, FormData>(accionAltaPieza, {});
  const [prefijo, setPrefijo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [sugiriendo, setSugiriendo] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const hidratado = useHidratado();
  useEnfocarPrimerInvalido(form, estado);

  // Éxito: `ok` trae el código creado. Se avisa al buscador y se va a la ficha.
  useEffect(() => {
    if (!estado.ok) return;
    marcarIndiceSucio();
    router.push(`/panel/inventario/${encodeURIComponent(estado.ok)}`);
  }, [estado, router]);

  // Tras un alta exitosa el botón sigue deshabilitado hasta que llegue la navegación: sin doble alta.
  const enviando = pendiente || Boolean(estado.ok);

  async function sugerir() {
    if (sugiriendo) return;
    setSugiriendo(true);
    try {
      const r = await accionSugerirCodigo(prefijo);
      setAviso(r.error ?? null);
      if (r.codigo) setCodigo(r.codigo);
    } catch {
      // Red caída o sesión vencida: la acción no llegó a responder.
      setAviso('No se pudo sugerir el código. Intenta de nuevo.');
    } finally {
      setSugiriendo(false);
    }
  }

  return (
    <form
      ref={form}
      method="post"
      data-hidratado={hidratado ? 'si' : 'no'}
      className="flex max-w-xl flex-col gap-3"
      aria-busy={enviando}
      onSubmit={(e) => {
        e.preventDefault();
        if (enviando) return;
        const datos = new FormData(e.currentTarget);
        startTransition(() => despachar(datos));
      }}
    >
      <ErroresCampo.Provider value={estado.campos ?? {}}>
        <div className="flex items-end gap-2">
          <Campo
            etiqueta="Prefijo"
            name="prefijo"
            value={prefijo}
            onChange={(e) => setPrefijo(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="AI"
          />
          <button
            type="button"
            onClick={sugerir}
            disabled={sugiriendo}
            aria-busy={sugiriendo}
            className="min-h-11 rounded-lg border border-secundario bg-white px-4 font-medium text-secundario enabled:hover:bg-secundario-suave disabled:opacity-60"
          >
            Sugerir código
          </button>
        </div>
        {aviso && (
          <p role="alert" className="aviso-error">
            {aviso}
          </p>
        )}
        <Campo
          etiqueta="Código"
          name="codigo"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          required
          maxLength={20}
        />
        <Campo etiqueta="Categoría" name="categoria" list="categorias" required maxLength={80} />
        <datalist id="categorias">
          {categorias.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Campo etiqueta="Descripción" name="descripcion" required maxLength={300} />
        <Campo etiqueta="Material" name="material" maxLength={80} />
        <Campo etiqueta="Proveedor" name="proveedor" maxLength={80} />
        <Campo etiqueta="Costo" name="costo" inputMode="decimal" placeholder="65" />
        <Campo etiqueta="Precio" name="precio" inputMode="decimal" required placeholder="149" />
      </ErroresCampo.Provider>
      {estado.error && (
        <p role="alert" className="aviso-error">
          {estado.campos ? 'Revisa los campos marcados.' : estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando || !hidratado}
        className="min-h-11 self-start rounded-lg bg-primario px-4 font-medium text-white enabled:hover:bg-primario-fuerte disabled:opacity-60"
      >
        Guardar pieza
      </button>
    </form>
  );
}
