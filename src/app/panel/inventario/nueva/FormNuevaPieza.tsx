'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  startTransition,
  useActionState,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type SubmitEvent,
} from 'react';
import { SelectorFoto } from '@/features/imagenes/SelectorFoto';
import { Campo } from '@/features/ui/Campo';
import { CampoConLista } from '@/features/ui/CampoConLista';
import { ErroresCampo, useEnfocarPrimerInvalido } from '@/features/ui/errores-campo';
import type { EstadoAccion } from '@/features/ui/estado';
import { useHidratado } from '@/features/ui/hidratado';
import { marcarIndiceSucio } from '@/search/eventos';
import { accionAltaPieza, accionSugerirCodigo } from '../acciones';

export function FormNuevaPieza({
  categorias,
  materiales,
  proveedores,
}: {
  categorias: string[];
  materiales: string[];
  proveedores: string[];
}) {
  const router = useRouter();
  const [estado, despachar, pendiente] = useActionState<EstadoAccion, FormData>(accionAltaPieza, {});
  const [prefijo, setPrefijo] = useState('');
  const [codigo, setCodigo] = useState('');
  // Estado de la foto elegida. "Guardar y agregar otra" lo reinicia junto con la `key` de SelectorFoto
  // (vista previa e inputs de archivo), para que la siguiente pieza no herede la imagen anterior.
  const [foto, setFoto] = useState<File | null>(null);
  // Cada alta "otra" sube la ronda: remonta (y vacía) los campos no controlados y los selectores de foto.
  const [ronda, setRonda] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sugiriendo, setSugiriendo] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const foco = useRef<'codigo' | 'descripcion' | null>(null);
  const hidratado = useHidratado();
  useEnfocarPrimerInvalido(form, estado);

  const seguirCapturando = estado.siguiente === 'otra';

  // Reinicio al llegar un alta "otra": se ajusta durante el render (no en un efecto) para no encadenar renders.
  const [vistoEstado, setVistoEstado] = useState(estado);
  if (estado !== vistoEstado) {
    setVistoEstado(estado);
    if (estado.ok && estado.siguiente === 'otra') {
      setCodigo('');
      setFoto(null);
      setAviso(null);
      setRonda((r) => r + 1);
    }
  }

  const pedirSiguiente = useEffectEvent((): Promise<{ codigo?: string }> =>
    prefijo ? accionSugerirCodigo(prefijo) : Promise.resolve({}),
  );

  // Éxito: `ok` trae el código creado. Se avisa al buscador y se va a la ficha (o se sigue capturando).
  // Va antes del efecto del foco: este deja el foco pedido y aquel lo aplica en el mismo commit.
  useEffect(() => {
    if (!estado.ok) return;
    marcarIndiceSucio();
    if (estado.siguiente === 'otra') {
      foco.current = 'codigo';
      // Sugiere el siguiente consecutivo del mismo prefijo; si llega, el foco pasa a la descripción.
      pedirSiguiente()
        .then((r) => {
          if (!r.codigo) return;
          foco.current = 'descripcion';
          setCodigo(r.codigo);
        })
        .catch(() => {});
    } else router.push(`/panel/inventario/${encodeURIComponent(estado.ok)}`);
  }, [estado, router]);

  // Foco en el campo pedido tras guardar y agregar otra (ya con los campos remontados).
  useEffect(() => {
    if (!foco.current) return;
    form.current?.querySelector<HTMLElement>(`[name="${foco.current}"]`)?.focus();
    foco.current = null;
  }, [ronda, codigo]);

  // Tras un alta exitosa el botón sigue deshabilitado hasta que llegue la navegación: sin doble alta.
  // Con "agregar otra" el formulario queda libre para la siguiente pieza.
  const enviando = pendiente || (Boolean(estado.ok) && !seguirCapturando);

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

  const guardada = seguirCapturando && !pendiente ? estado.ok : undefined;

  return (
    <form
      ref={form}
      method="post"
      data-hidratado={hidratado ? 'si' : 'no'}
      className="flex max-w-xl flex-col gap-3"
      aria-busy={enviando}
      onSubmit={(e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (enviando) return;
        // El botón que envió ("Guardar y agregar otra" lleva name=siguiente value=otra) entra en los datos.
        const datos = new FormData(e.currentTarget, e.nativeEvent.submitter);
        if (foto) datos.set('imagen', foto);
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
        <CampoConLista etiqueta="Categoría" name="categoria" opciones={categorias} required maxLength={80} />
        <Campo
          key={`descripcion-${ronda}`}
          etiqueta="Descripción"
          name="descripcion"
          required
          maxLength={300}
        />
        <CampoConLista etiqueta="Material" name="material" opciones={materiales} maxLength={80} />
        <CampoConLista etiqueta="Proveedor" name="proveedor" opciones={proveedores} maxLength={80} />
        <Campo key={`costo-${ronda}`} etiqueta="Costo" name="costo" inputMode="decimal" placeholder="65" />
        <Campo
          key={`precio-${ronda}`}
          etiqueta="Precio"
          name="precio"
          inputMode="decimal"
          required
          placeholder="149"
        />
        <SelectorFoto key={`foto-${ronda}`} etiqueta="Foto (opcional)" onCambio={setFoto} />
      </ErroresCampo.Provider>
      {estado.error && (
        <p role="alert" className="aviso-error">
          {estado.campos ? 'Revisa los campos marcados.' : estado.error}
        </p>
      )}
      <p role="status" className="text-meta text-tinta-suave">
        {enviando && foto ? 'Subiendo…' : ''}
      </p>
      {/* Siempre montado: una región que nace con texto no se anuncia. */}
      <p role="status" className={guardada ? 'aviso-exito' : undefined}>
        {guardada && (
          <>
            Pieza {guardada} guardada. Agrega la siguiente.{' '}
            <Link href={`/panel/inventario/${encodeURIComponent(guardada)}`} className="enlace">
              Ver {guardada}
            </Link>
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={enviando || !hidratado}
          className="min-h-11 rounded-lg bg-primario px-4 font-medium text-white enabled:hover:bg-primario-fuerte disabled:opacity-60"
        >
          Guardar pieza
        </button>
        <button
          type="submit"
          name="siguiente"
          value="otra"
          disabled={enviando || !hidratado}
          className="min-h-11 rounded-lg border border-secundario bg-white px-4 font-medium text-secundario enabled:hover:bg-secundario-suave disabled:opacity-60"
        >
          Guardar y agregar otra
        </button>
      </div>
    </form>
  );
}
