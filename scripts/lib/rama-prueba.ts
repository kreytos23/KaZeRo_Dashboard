import { existsSync, readFileSync } from 'node:fs';
import { describirUrl, GuardaBdError, hostNormalizado } from './guarda-bd';

/**
 * Modo "Postgres directo" de scripts/test-neon.ts: en CI las pruebas usan el Postgres de servicio de GitHub
 * Actions en vez de crear ramas Neon (las ramas temporales agotaban la cuota de almacenamiento de Neon).
 * Solo se acepta un servidor local o el servicio de CI, y solo bases test_*.
 */
export const HOSTS_PG_DIRECTO: readonly string[] = ['localhost', '127.0.0.1', 'postgres'];
export const PREFIJO_BASE_PRUEBA = 'test_';

export const MENSAJE_SIN_MODO =
  'Las pruebas de integración/E2E corren en GitHub Actions (Postgres de servicio, sin ramas Neon). ' +
  'Para usar Neon a propósito: KAZERO_TEST_NEON=1 pnpm test:integracion (o test:e2e); crea ramas ' +
  'temporales y gasta cuota de Neon. Con un Postgres propio: KAZERO_PG_PRUEBAS_URL=<URL de superusuario> ' +
  'y KAZERO_PG_WSPROXY=<host:puerto del wsproxy>.';

/** Postgres directo gana sobre Neon; sin ninguno de los dos no se corre nada (null). */
export function modoPruebas(e: Partial<NodeJS.ProcessEnv>): 'pg' | 'neon' | null {
  if (e.KAZERO_PG_PRUEBAS_URL) return 'pg';
  return e.KAZERO_TEST_NEON === '1' ? 'neon' : null;
}

/** Aborta (sin mostrar la URL) si el destino no es un Postgres local/de CI o, con `base`, si no es esa base test_*. */
export function verificarUrlPgDirecto(url: string, etiqueta: string, base?: string) {
  const d = describirUrl(url, etiqueta);
  if (!HOSTS_PG_DIRECTO.includes(d.host)) {
    throw new GuardaBdError(
      `${etiqueta} apunta a ${d.host}: en modo Postgres directo solo se aceptan ${HOSTS_PG_DIRECTO.join(', ')}.`,
    );
  }
  if (base !== undefined && (!base.startsWith(PREFIJO_BASE_PRUEBA) || d.baseDatos !== base)) {
    throw new GuardaBdError(
      `${etiqueta} no apunta a la base de prueba ${base}. Abortando antes de tocar datos.`,
    );
  }
  return d;
}

export const ARCHIVO_RAMA_PRUEBA = '.neon-prueba.json';

/** Integración en paralelo: un archivo de registro por worker (rama propia). */
export const archivoRamaTrabajador = (indice: number) => `.neon-prueba-${indice}.json`;

/**
 * Las suites truncan tablas: si alguna vez pueden apuntar a otra base, acabarán haciéndolo (lecciones §3).
 * Solo se permite la rama test-* que acaba de crear scripts/test-neon.ts o, en modo Postgres directo
 * (KAZERO_PG_PRUEBAS_URL), la base test_* que creó en un Postgres local o de CI.
 */
export function verificarRamaPrueba(e: Partial<NodeJS.ProcessEnv>, archivo = ARCHIVO_RAMA_PRUEBA) {
  const rama = e.KAZERO_RAMA_PRUEBA;
  const directo = !!e.KAZERO_PG_PRUEBAS_URL;
  if (!rama?.startsWith(directo ? PREFIJO_BASE_PRUEBA : 'test-') || !existsSync(archivo)) {
    throw new Error(
      'Las pruebas de integración/E2E solo corren en una rama Neon test-* (o base test_*) creada por ' +
        '`pnpm test:integracion` o `pnpm test:e2e`. No las corras directo con vitest/playwright.',
    );
  }
  const info = JSON.parse(readFileSync(archivo, 'utf8')) as { rama: string; host: string };
  if (info.rama !== rama) throw new Error(`La rama registrada (${info.rama}) no coincide con ${rama}.`);
  for (const v of ['DATABASE_URL', 'DATABASE_URL_OWNER'] as const) {
    const url = e[v];
    if (url && directo) verificarUrlPgDirecto(url, v, rama);
    if (!url || hostNormalizado(url) !== info.host) {
      throw new Error(`${v} no apunta a la rama de prueba ${rama}. Abortando antes de tocar datos.`);
    }
  }
  return info;
}
