/** Importación única de clientas con su tarjeta (2026-11-16). Ver scripts/importar-tarjetas/cli.ts. */
import { etiquetaErrorBd } from '../src/db/reintento';
import { ejecutarTarjetas } from './importar-tarjetas/cli';

// Un error de BD trae la consulta y sus parámetros (nombres): solo se muestran SQLSTATE y restricción.
function describirError(e: unknown): string {
  const causa = (e as { cause?: { code?: unknown; constraint?: unknown } } | null)?.cause;
  if (causa && typeof causa.code === 'string')
    return `Error de BD ${etiquetaErrorBd(causa)}${typeof causa.constraint === 'string' ? ` (${causa.constraint})` : ''}. ROLLBACK: no quedó nada.`;
  return e instanceof Error ? `${e.name}: ${e.message}` : 'Error desconocido';
}

ejecutarTarjetas(process.argv.slice(2))
  .then((codigo) => process.exit(codigo))
  .catch((e: unknown) => {
    console.error(describirError(e));
    process.exit(1);
  });
