import { existsSync, readFileSync } from 'node:fs';
import { hostNormalizado } from './guarda-bd';

export const ARCHIVO_RAMA_PRUEBA = '.neon-prueba.json';

/**
 * Las suites truncan tablas: si alguna vez pueden apuntar a otra base, acabarán haciéndolo (lecciones §3).
 * Solo se permite la rama test-* que acaba de crear scripts/test-neon.ts.
 */
export function verificarRamaPrueba(e: Partial<NodeJS.ProcessEnv>, archivo = ARCHIVO_RAMA_PRUEBA) {
  const rama = e.KAZERO_RAMA_PRUEBA;
  if (!rama?.startsWith('test-') || !existsSync(archivo)) {
    throw new Error(
      'Las pruebas de integración/E2E solo corren en una rama Neon test-* creada por ' +
        '`pnpm test:integracion` o `pnpm test:e2e`. No las corras directo con vitest/playwright.',
    );
  }
  const info = JSON.parse(readFileSync(archivo, 'utf8')) as { rama: string; host: string };
  if (info.rama !== rama) throw new Error(`La rama registrada (${info.rama}) no coincide con ${rama}.`);
  for (const v of ['DATABASE_URL', 'DATABASE_URL_OWNER'] as const) {
    const url = e[v];
    if (!url || hostNormalizado(url) !== info.host) {
      throw new Error(`${v} no apunta a la rama de prueba ${rama}. Abortando antes de tocar datos.`);
    }
  }
  return info;
}
