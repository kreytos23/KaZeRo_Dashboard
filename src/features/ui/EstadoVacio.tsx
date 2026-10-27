import Link from 'next/link';

/**
 * Lista sin resultados que enseña el siguiente paso: dice qué pasa y ofrece la acción (crear el primero o
 * quitar los filtros) en vez de un «no hay nada» sin salida.
 */
export function EstadoVacio({
  titulo,
  detalle,
  accion,
  principal = false,
}: {
  titulo: string;
  detalle?: string;
  accion?: { href: string; texto: string };
  /** La acción es crear algo nuevo (botón primario) y no solo quitar filtros. */
  principal?: boolean;
}) {
  return (
    <div className="tarjeta flex flex-col items-start gap-3 p-5">
      <div className="flex flex-col gap-1">
        <p className="text-monto font-semibold">{titulo}</p>
        {detalle && <p className="text-dato text-tinta-suave">{detalle}</p>}
      </div>
      {accion && (
        <Link href={accion.href} className={principal ? 'boton-primario' : 'boton-secundario'}>
          {accion.texto}
        </Link>
      )}
    </div>
  );
}
