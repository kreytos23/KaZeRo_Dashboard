import type { EntradaHistorial } from '@/domain/auditoria';
import { Fecha } from '@/features/ui/Fecha';
import { ETIQUETA_CAMPO, formatearValor } from './formato';

/** Historial de una ficha (R-08). Las entradas ya vienen agrupadas de una sola consulta (sin N+1). */
export function HistorialCambios({
  entradas,
  idTitulo = 'historial-cambios',
  titulo = 'Historial de cambios',
  nivel = 2,
}: {
  entradas: readonly EntradaHistorial[];
  idTitulo?: string;
  titulo?: string;
  nivel?: 2 | 3;
}) {
  const Titulo = nivel === 2 ? 'h2' : 'h3';
  return (
    <section aria-labelledby={idTitulo} className="flex flex-col gap-2">
      <Titulo id={idTitulo} className={nivel === 2 ? 'text-lg font-semibold' : 'font-semibold'}>
        {titulo}
      </Titulo>
      {entradas.length === 0 ? (
        <p className="text-sm text-tinta-suave">Sin cambios registrados.</p>
      ) : (
        <ol className="flex flex-col gap-3 text-sm">
          {entradas.map((e) => (
            <li key={e.id} className="border-l-2 border-marca-rubor pl-3">
              <p className="text-tinta-suave">
                <Fecha fecha={e.fecha} /> · {e.adminEmail}
              </p>
              <ul>
                {e.campos.map((c) => (
                  <li key={c.campo}>
                    <span className="font-medium">{ETIQUETA_CAMPO[c.campo] ?? c.campo}:</span>{' '}
                    {formatearValor(c.campo, c.antes)} → {formatearValor(c.campo, c.despues)}
                  </li>
                ))}
              </ul>
              {e.motivo && <p>Motivo: {e.motivo}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
