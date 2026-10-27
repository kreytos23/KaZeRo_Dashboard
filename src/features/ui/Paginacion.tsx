import Link from 'next/link';
import { calcularPaginacion } from '@/domain/paginacion';

type Parametros = Record<string, string | undefined>;

/** `?filtros&pagina=N`; la página 1 no lleva parámetro (URL canónica). */
export function enlacePagina(parametros: Parametros, pagina: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) if (v) qs.set(k, v);
  if (pagina > 1) qs.set('pagina', String(pagina));
  const t = qs.toString();
  return t ? `?${t}` : '?';
}

const fmt = new Intl.NumberFormat('es-MX');

/**
 * Paginación numerada con enlaces reales (funciona sin JS). `parametros` son los filtros vigentes: se
 * conservan en cada enlace. Se oculta si todo cabe en una página. En celular solo se ven las flechas,
 * la actual con sus vecinas y el salto a la última; desde `sm` la ventana completa con «…».
 */
export function Paginacion({
  pagina,
  total,
  porPagina,
  parametros,
}: {
  pagina: number;
  total: number;
  porPagina: number;
  parametros: Parametros;
}) {
  const p = calcularPaginacion({ pagina, total, porPagina });
  if (p.totalPaginas <= 1) return null;
  const anterior = p.pagina > 1;
  const siguiente = p.pagina < p.totalPaginas;
  const flecha = (activa: boolean, destino: number, etiqueta: string, texto: string, flechita: string) => {
    const contenido = (
      <>
        <span aria-hidden="true" className="sm:hidden">
          {flechita}
        </span>
        <span aria-hidden="true" className="hidden sm:inline">
          {texto}
        </span>
      </>
    );
    return activa ? (
      <Link href={enlacePagina(parametros, destino)} aria-label={etiqueta} className="pagina-enlace">
        {contenido}
      </Link>
    ) : (
      <span aria-hidden="true" aria-disabled="true" className="pagina-enlace">
        {contenido}
      </span>
    );
  };
  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
      <p className="text-meta text-tinta-suave">
        Mostrando {fmt.format(p.desde)}–{fmt.format(p.hasta)} de {fmt.format(p.total)}
      </p>
      <nav aria-label="Paginación">
        <ul className="flex items-center gap-1.5">
          <li>{flecha(anterior, p.pagina - 1, 'Página anterior', 'Anterior', '‹')}</li>
          {p.elementos.map((e) => {
            if (e.tipo === 'hueco') {
              return (
                <li key={e.clave} aria-hidden="true" className="hidden px-1 text-tinta-suave sm:block">
                  …
                </li>
              );
            }
            const n = e.numero;
            const actual = n === p.pagina;
            const ultima = n === p.totalPaginas;
            // Celular: solo la actual, sus vecinas y la última (salto); el resto aparece desde `sm`.
            const visibleMovil = Math.abs(n - p.pagina) <= 1 || ultima;
            return (
              <li key={n} className={visibleMovil ? undefined : 'hidden sm:block'}>
                <Link
                  href={enlacePagina(parametros, n)}
                  aria-current={actual ? 'page' : undefined}
                  aria-label={
                    ultima && !actual ? `Última página (${fmt.format(n)})` : `Página ${fmt.format(n)}`
                  }
                  className="pagina-enlace"
                >
                  {fmt.format(n)}
                </Link>
              </li>
            );
          })}
          <li>{flecha(siguiente, p.pagina + 1, 'Página siguiente', 'Siguiente', '›')}</li>
        </ul>
      </nav>
    </div>
  );
}
