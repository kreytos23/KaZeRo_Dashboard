import { urlImagenPieza, type Variante } from '@/domain/imagenes';

const TAM: Record<Variante, number> = { grande: 1600, mini: 48 };

/**
 * <img> normal, no next/image: el optimizador pediría la foto sin las cookies del usuario (401) y
 * /_next/image no pasa por el proxy. Caja cuadrada fija: sin salto de diseño (D1, D9).
 */
export function FotoPieza({
  piezaId,
  clave,
  alt,
  variante,
}: {
  piezaId: string;
  clave: string | null;
  alt: string;
  variante: Variante;
}) {
  const caja =
    variante === 'grande'
      ? 'aspect-square w-full max-w-sm rounded-lg border border-borde bg-superficie object-contain'
      : 'size-12 rounded border border-borde bg-superficie object-cover';
  if (!clave)
    return variante === 'grande' ? (
      <div className={`${caja} flex items-center justify-center text-meta text-tinta-suave`}>Sin foto</div>
    ) : (
      <span aria-hidden="true" className={`${caja} inline-block`} />
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- foto privada servida por /api con sesión (ver arriba)
    <img
      src={urlImagenPieza(piezaId, clave, variante)}
      alt={alt}
      width={TAM[variante]}
      height={TAM[variante]}
      loading={variante === 'grande' ? 'eager' : 'lazy'}
      decoding="async"
      className={caja}
    />
  );
}
