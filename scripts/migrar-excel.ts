/**
 * Migración del Excel (Plan 7a). Uso:
 *   pnpm excel:migrar -- --modo=sugerir --inventario "<ruta inventario.xlsx>" --tracking "<ruta tracking.xlsx>"
 *   pnpm excel:migrar -- --modo=simular --inventario "<ruta>" --tracking "<ruta>" [--mapeo docs/migracion/mapeo.json]
 *   pnpm excel:migrar -- --modo=ensayo  … (mismas rutas)
 *   pnpm excel:migrar -- --modo=aplicar … --plan=<hash del reporte aprobado> [--confirmo-produccion]
 *
 * `sugerir` y `simular` no tocan ninguna BD. `ensayo` y `aplicar` usan DATABASE_URL_OWNER con la guarda
 * (terminal vs .env.local; producción exige KAZERO_OTRA_BD=confirmo y, para aplicar, también
 * --confirmo-produccion). `ensayo` termina siempre en ROLLBACK; `aplicar` solo confirma si la verificación cuadra.
 * La consola solo imprime destino, conteos, el hash y rutas: los nombres y montos por persona van únicamente al
 * reporte local (carpeta ignorada por git). Detalle y códigos de salida en scripts/migrar-excel/cli.ts.
 */
import { describirError } from './lib/describir-error';
import { ejecutar } from './migrar-excel/cli';

/** Un error de BD trae la consulta y sus parámetros (datos del Excel): solo se muestran SQLSTATE y restricción. */
ejecutar(process.argv.slice(2))
  .then((codigo) => process.exit(codigo))
  .catch((e: unknown) => {
    console.error(describirError(e));
    process.exit(1);
  });
