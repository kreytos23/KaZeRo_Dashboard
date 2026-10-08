import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { hostNormalizado } from './lib/guarda-bd';
import { asignarPasswordApp, migrar } from './lib/migrar';
import { borrarRama, cadenaConexion, crearRama } from './lib/neon';
import { ARCHIVO_RAMA_PRUEBA } from './lib/rama-prueba';

const modo = process.argv[2];
if (modo !== 'integracion' && modo !== 'e2e') {
  console.error('Uso: tsx scripts/test-neon.ts <integracion|e2e> [args extra]');
  process.exit(2);
}

const sufijo = process.env.GITHUB_RUN_ID
  ? `ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}-${modo}`
  : `${userInfo()
      .username.toLowerCase()
      .replace(/[^a-z0-9]/g, '')}-${Date.now()}`;
const rama = `test-${sufijo}`;

// Hija de development: copia instantánea (copy-on-write). Caduca en 2 h por si el proceso muere antes de borrarla.
console.log(`[test-neon] Creando rama temporal ${rama} (padre: development)…`);
crearRama(rama, 'development', 2);
try {
  const owner = cadenaConexion(rama);
  await migrar(owner);
  const app = await asignarPasswordApp(owner);
  writeFileSync(ARCHIVO_RAMA_PRUEBA, JSON.stringify({ rama, host: hostNormalizado(owner) }));

  const comando =
    modo === 'integracion' ? ['vitest', 'run', '--project', 'integration'] : ['playwright', 'test'];
  const r = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', ...comando, ...process.argv.slice(3)],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        DATABASE_URL: app,
        DATABASE_URL_OWNER: owner,
        KAZERO_RAMA_PRUEBA: rama,
        KAZERO_TOTP_KEY: randomBytes(32).toString('base64'),
      },
    },
  );
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(ARCHIVO_RAMA_PRUEBA, { force: true });
  console.log(`[test-neon] Borrando rama ${rama}…`);
  borrarRama(rama);
}
