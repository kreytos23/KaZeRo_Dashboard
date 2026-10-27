/**
 * Importación de notas KZR históricas desde Excel (fresh restart). Uso:
 *   pnpm excel:kzr simular <archivo.xlsx>                 (solo lectura: reporte de conciliación y hash del plan)
 *   pnpm excel:kzr ensayo  <archivo.xlsx> [--plan=<hash>] (aplica todo en una transacción y hace ROLLBACK)
 *   pnpm excel:kzr aplicar <archivo.xlsx> --plan=<hash> [--confirmo-produccion --respaldo=<rama Neon existente>]
 * Usa DATABASE_URL_OWNER con la guarda (terminal vs .env.local; producción exige KAZERO_OTRA_BD=confirmo y, para
 * aplicar, además --confirmo-produccion y --respaldo). Detalle y códigos de salida en scripts/importar-kzr/cli.ts.
 */
import { etiquetaErrorBd } from '../src/db/reintento';
import { ejecutar } from './importar-kzr/cli';

/** Un error de BD trae la consulta y sus parámetros (datos del Excel): solo se muestran SQLSTATE y restricción. */
function describirError(e: unknown): string {
  const causa = (e as { cause?: { code?: unknown; constraint?: unknown } } | null)?.cause;
  if (causa && typeof causa.code === 'string')
    return `Error de BD ${etiquetaErrorBd(causa)}${typeof causa.constraint === 'string' ? ` (${causa.constraint})` : ''}. ROLLBACK: no quedó nada.`;
  return e instanceof Error ? `${e.name}: ${e.message}` : 'Error desconocido';
}

ejecutar(process.argv.slice(2))
  .then((codigo) => process.exit(codigo))
  .catch((e: unknown) => {
    console.error(describirError(e));
    process.exit(1);
  });
