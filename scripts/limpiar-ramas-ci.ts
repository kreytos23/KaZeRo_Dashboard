import { borrarRama, listarRamas } from './lib/neon';

/**
 * Red de seguridad de CI: al cancelar una corrida, GitHub mata el proceso antes de que test-neon termine de
 * borrar sus ramas y quedan ocupando el cupo del plan (caducan solas a las 2 h). Borra las de esta corrida.
 */
const id = process.env.GITHUB_RUN_ID;
const modo = process.argv[2];
if (!id || !modo) {
  console.error('Uso (solo CI): tsx scripts/limpiar-ramas-ci.ts <integracion|e2e>');
  process.exit(2);
}
const prefijo = `test-ci-${id}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}-${modo}`;
for (const nombre of listarRamas().filter((n) => n.startsWith(prefijo))) {
  console.log(`[limpiar-ramas-ci] Borrando ${nombre}…`);
  try {
    borrarRama(nombre);
  } catch (e) {
    console.error(`[limpiar-ramas-ci] No se pudo borrar ${nombre}: ${(e as Error).message}`);
  }
}
