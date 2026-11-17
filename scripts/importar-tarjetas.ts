/** Importación única de clientas con su tarjeta (2026-11-16). Ver scripts/importar-tarjetas/cli.ts. */
import { describirError } from './lib/describir-error';
import { ejecutarTarjetas } from './importar-tarjetas/cli';

// Un error de BD trae la consulta y sus parámetros (nombres): solo se muestran SQLSTATE y restricción.
ejecutarTarjetas(process.argv.slice(2))
  .then((codigo) => process.exit(codigo))
  .catch((e: unknown) => {
    console.error(describirError(e));
    process.exit(1);
  });
