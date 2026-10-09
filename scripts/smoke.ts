import { verificarDespliegue } from './lib/smoke';

const base = process.argv[2];
if (!base) {
  console.error('Uso: pnpm smoke <url>');
  process.exit(2);
}
let fallos: string[];
try {
  fallos = await verificarDespliegue(base, {
    commitEsperado: process.env.KAZERO_COMMIT_SHA ?? 'local',
    bypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
} catch (err) {
  // Nada debería llegar aquí (los errores de red ya son fallos), pero si llega: sin stack.
  fallos = [err instanceof Error ? `${err.name}: ${err.message}` : 'error desconocido'];
}
if (fallos.length) {
  console.error(`[smoke] ${base} FALLÓ:\n - ${fallos.join('\n - ')}`);
  process.exit(1);
}
console.log(`[smoke] ${base} OK`);
