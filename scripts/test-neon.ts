import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { hostNormalizado } from './lib/guarda-bd';
import { asignarPasswordApp, migrar } from './lib/migrar';
import { borrarRama, cadenaConexion, contarRamas, crearRama } from './lib/neon';
import { ARCHIVO_RAMA_PRUEBA, archivoRamaTrabajador } from './lib/rama-prueba';
import { LIMITE_RAMAS_NEON, trabajadoresDisponibles, trabajadoresPedidos } from './lib/ramas-paralelas';

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

// E2E guarda las fotos en directorios temporales (nunca Blob real), uno por servidor; se borran al terminar.
const dirsImagenes: string[] = [];

interface RamaPrueba {
  rama: string;
  owner: string;
  app: string;
}
const ramas: RamaPrueba[] = [];
const creadas: string[] = [];
const archivos: string[] = [ARCHIVO_RAMA_PRUEBA];
// E2E: un proyecto de Playwright por rama y por servidor, en paralelo (a menos que se pida un --project concreto).
const PROYECTOS_E2E = ['escritorio', 'movil'];
const PUERTO_E2E = 3100;
const hijos: ReturnType<typeof spawn>[] = [];
let limpio = false;

/** Idempotente: se llama desde el finally y desde Ctrl+C/SIGTERM. Intenta borrar TODAS aunque alguna falle. */
function limpiar() {
  if (limpio) return;
  limpio = true;
  for (const f of archivos) rmSync(f, { force: true });
  for (const d of dirsImagenes) rmSync(d, { recursive: true, force: true });
  for (const nombre of creadas) {
    console.log(`[test-neon] Borrando rama ${nombre}…`);
    try {
      borrarRama(nombre);
    } catch (e) {
      console.error(`[test-neon] No se pudo borrar ${nombre}: ${(e as Error).message}`);
      process.exitCode ||= 1;
    }
  }
}
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    console.error(`[test-neon] ${senal}: abortando y borrando las ramas…`);
    for (const h of hijos) h.kill();
    limpiar();
    process.exit(130);
  });
}

try {
  // Integración corre un worker de Vitest por rama (cada archivo trunca a sus anchas); E2E usa una sola rama.
  let n = 1;
  const extra = process.argv.slice(3);
  const eligeProyecto = extra.some((a) => a === '--project' || a.startsWith('--project=') || a === '-p');
  if (modo === 'e2e' && !eligeProyecto) n = PROYECTOS_E2E.length;
  if (modo === 'integracion' || n > 1) {
    const pedidos = modo === 'integracion' ? trabajadoresPedidos(process.env.KAZERO_TEST_WORKERS) : n;
    const limite = Number(process.env.KAZERO_LIMITE_RAMAS) || LIMITE_RAMAS_NEON;
    n = trabajadoresDisponibles(pedidos, contarRamas(), limite);
    if (n < 1)
      throw new Error(`No caben ramas de prueba (límite ${limite} en el plan). Borra ramas test-* viejas.`);
    if (n < pedidos)
      console.warn(`[test-neon] Solo caben ${n} de ${pedidos} workers por el límite de ramas.`);
  }

  // Hijas de development: copia instantánea (copy-on-write). Caducan en 2 h por si el proceso muere antes de borrarlas.
  for (let i = 0; i < n; i++) {
    const nombre = n === 1 ? `test-${sufijo}` : `test-${sufijo}-w${i + 1}`;
    console.log(`[test-neon] Creando rama temporal ${nombre} (padre: development)…`);
    try {
      crearRama(nombre, 'development', 2);
    } catch (e) {
      // Una carrera con otro CI pudo agotar el cupo: seguimos con las que ya hay.
      if (creadas.length === 0) throw e;
      console.warn(`[test-neon] No se pudo crear ${nombre}; se sigue con ${creadas.length} worker(s).`);
      break;
    }
    creadas.push(nombre);
  }
  await Promise.all(
    creadas.map(async (rama) => {
      const owner = cadenaConexion(rama);
      await migrar(owner);
      ramas.push({ rama, owner, app: await asignarPasswordApp(owner) });
    }),
  );
  ramas.sort((a, b) => a.rama.localeCompare(b.rama));

  const base = {
    ...process.env,
    KAZERO_TOTP_KEY: randomBytes(32).toString('base64'),
  };
  const registrar = (r: RamaPrueba, i: number) => {
    const archivo = archivoRamaTrabajador(i);
    archivos.push(archivo);
    writeFileSync(archivo, JSON.stringify({ rama: r.rama, host: hostNormalizado(r.owner) }));
    return archivo;
  };
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const lanzar = (comando: string[], env: NodeJS.ProcessEnv) =>
    new Promise<number>((resolver) => {
      const h = spawn(pnpm, ['exec', ...comando], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env,
      });
      hijos.push(h);
      h.on('exit', (codigo) => resolver(codigo ?? 1));
      h.on('error', () => resolver(1));
    });

  let codigos: number[];
  if (modo === 'integracion') {
    ramas.forEach(registrar);
    // Cada worker de Vitest elige su rama por VITEST_POOL_ID (tests/integration/setup.ts, que además la verifica).
    // DATABASE_URL* no se exportan aquí a propósito: sin worker asignado, nada debe poder tocar una base.
    codigos = [
      await lanzar(['vitest', 'run', '--project', 'integration', ...extra], {
        ...base,
        KAZERO_RAMAS_PRUEBA: JSON.stringify(ramas),
        KAZERO_TEST_WORKERS: String(ramas.length),
      }),
    ];
  } else {
    // Un servidor, una rama y un directorio de datos y de fotos por proyecto; nada se comparte entre ellos.
    const paralelo = ramas.length > 1;
    codigos = await Promise.all(
      ramas.map((r, i) => {
        const proyecto = paralelo ? PROYECTOS_E2E[i]! : null;
        const dirImagenes = mkdtempSync(join(tmpdir(), 'kazero-e2e-imagenes-'));
        dirsImagenes.push(dirImagenes);
        const sufijoDir = proyecto ? `/${proyecto}` : '';
        return lanzar(
          [
            'playwright',
            'test',
            ...(proyecto ? ['--project', proyecto, '--output', `test-results${sufijoDir}`] : []),
            ...extra,
          ],
          {
            ...base,
            DATABASE_URL: r.app,
            DATABASE_URL_OWNER: r.owner,
            KAZERO_RAMA_PRUEBA: r.rama,
            KAZERO_ARCHIVO_RAMA: registrar(r, i),
            KAZERO_E2E_PUERTO: String(PUERTO_E2E + i),
            KAZERO_E2E_DATOS: `playwright/.datos${sufijoDir}`,
            ...(proyecto ? { PLAYWRIGHT_HTML_REPORT: `playwright-report${sufijoDir}` } : {}),
            KAZERO_ALMACEN_IMAGENES: 'disco',
            KAZERO_DIR_IMAGENES: dirImagenes,
            // Token vacío: que un .env.local con el token del store de desarrollo no se cuele en E2E.
            BLOB_READ_WRITE_TOKEN: '',
          },
        );
      }),
    );
  }
  process.exitCode = codigos.find((c) => c !== 0) ?? 0;
} finally {
  limpiar();
}
