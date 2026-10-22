/**
 * Borra TODOS los datos de negocio (piezas, pedidos, pagos, personas, catálogos, bitácora, idempotencia,
 * origen_excel) y conserva cuentas de admin, sesiones, acceso_log y el esquema. Uso:
 *   KAZERO_OTRA_BD=confirmo pnpm exec tsx scripts/limpiar-datos-prueba.ts            (rama de prueba/copia)
 *   … --confirmo-development                                                         (development)
 *   … --confirmo-produccion --respaldo=<rama Neon de respaldo>                       (producción)
 * Solo imprime el destino (guarda) y conteos.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuardaBdError, hostNormalizado, prepararDestinoDetallado } from './lib/guarda-bd';
import { autorizarLimpieza, limpiarDatosPrueba, parsearArgsLimpieza } from './lib/limpieza';
import { cadenaConexion, listarRamas } from './lib/neon';

const RUTA_ENV = resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local');

try {
  const args = parsearArgsLimpieza(process.argv.slice(2));
  const destino = prepararDestinoDetallado(
    'DATABASE_URL_OWNER',
    'Limpiar TODOS los datos de negocio',
    RUTA_ENV,
    {
      exigirHostProduccion: true,
    },
  );
  const esDevelopment =
    hostNormalizado(destino.host) === hostNormalizado(cadenaConexion('development'), 'host de development');
  autorizarLimpieza(
    {
      esProduccion: destino.esProduccion,
      esDevelopment,
      otraBd: process.env.KAZERO_OTRA_BD === 'confirmo',
      ramas: destino.esProduccion ? listarRamas() : [],
    },
    args,
  );
  const borradas = await limpiarDatosPrueba(destino.url);
  console.log(`[limpieza] Filas borradas: ${JSON.stringify(borradas)}`);
} catch (e) {
  console.error(
    e instanceof GuardaBdError || e instanceof TypeError
      ? e.message
      : `Falló la limpieza (${(e as Error)?.name ?? 'error'}). ROLLBACK: no se borró nada.`,
  );
  process.exit(2);
}
