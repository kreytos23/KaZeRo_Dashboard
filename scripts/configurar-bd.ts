import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { sql } from 'drizzle-orm';
import { parse } from 'dotenv';
import { conDbUrl } from '../src/db/pool';
import { crearAdmin } from '../src/server/auth/admin';
import { describirUrl, hostNormalizado } from './lib/guarda-bd';
import { asignarPasswordApp, migrar } from './lib/migrar';
import { cadenaConexion } from './lib/neon';

const ES_WINDOWS = process.platform === 'win32';
const modo = process.argv[2];
if (modo !== 'desarrollo' && modo !== 'produccion') {
  console.error('Uso: pnpm bd:configurar <desarrollo|produccion> [--confirmo]');
  process.exit(2);
}
if (modo === 'produccion' && !process.argv.includes('--confirmo')) {
  console.error('Producción requiere --confirmo (cambia la contraseña de kazero_app en producción).');
  process.exit(2);
}

function ejecutar(cmd: string, args: string[], entrada: string) {
  // Solo pnpm es un shim .cmd en Windows; gh es gh.exe y cmd.exe lo resuelve por PATHEXT.
  const r = spawnSync(ES_WINDOWS && cmd === 'pnpm' ? 'pnpm.cmd' : cmd, args, {
    input: entrada,
    stdio: ['pipe', 'ignore', 'inherit'],
    shell: ES_WINDOWS,
  });
  if (r.status !== 0) throw new Error(`Falló: ${cmd} ${args.join(' ')}`);
}

/** Valor por stdin: nunca aparece en la línea de comandos ni en la salida. */
function vercelEnv(nombre: string, entorno: 'preview' | 'production', valor: string) {
  ejecutar(
    'pnpm',
    ['exec', 'vercel', 'env', 'add', nombre, entorno, '--sensitive', '--force', '--yes'],
    valor,
  );
  console.log(`  ✓ Vercel ${entorno}: ${nombre}`);
}

function ghSecret(nombre: string, environment: 'preview' | 'production', valor: string) {
  ejecutar('gh', ['secret', 'set', nombre, '--env', environment], valor);
  console.log(`  ✓ GitHub environment ${environment}: ${nombre}`);
}

function actualizarEnvLocal(valores: Record<string, string>) {
  const actual = existsSync('.env.local') ? parse(readFileSync('.env.local')) : {};
  const final = { ...actual, ...valores };
  writeFileSync(
    '.env.local',
    Object.entries(final)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join('\n') + '\n',
  );
  console.log(`  ✓ .env.local: ${Object.keys(valores).join(', ')}`);
}

const rama = modo === 'desarrollo' ? 'development' : 'production';
const owner = cadenaConexion(rama);
const d = describirUrl(owner);
console.log(`[bd:configurar] Rama ${rama} → ${d.usuario}@${d.host}/${d.baseDatos}`);

if (modo === 'produccion') {
  // Re-ejecutar rotaría la llave TOTP y el admin existente ya no podría entrar: se aborta ANTES de migrar.
  // En una BD nueva la tabla admin aún no existe, de ahí to_regclass.
  const hayTabla = await conDbUrl(owner, (db) =>
    db.execute<{ existe: boolean }>(sql`SELECT (to_regclass('public.admin') IS NOT NULL) AS existe`),
  );
  if (hayTabla.rows[0]?.existe) {
    const existentes = await conDbUrl(owner, (db) =>
      db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM admin`),
    );
    if ((existentes.rows[0]?.n ?? 0) > 0) {
      console.error(
        'Producción ya tiene admin. No se cambió nada (ni migraciones ni contraseñas): rotar rompería su TOTP. ' +
          'Para rotar, hazlo como tarea aparte.',
      );
      process.exit(1);
    }
  }
}

await migrar(owner);
console.log('  ✓ Migraciones aplicadas');

const app = await asignarPasswordApp(owner, { pooled: true });
console.log('  ✓ kazero_app con LOGIN y contraseña nueva');
const llaveTotp = randomBytes(32).toString('base64');

if (modo === 'desarrollo') {
  const hostProd = hostNormalizado(cadenaConexion('production'));
  actualizarEnvLocal({
    DATABASE_URL: app,
    DATABASE_URL_OWNER: owner,
    KAZERO_TOTP_KEY: llaveTotp,
    KAZERO_HOST_PROD: hostProd,
  });
  vercelEnv('DATABASE_URL', 'preview', app);
  // Los Previews usan la rama development: deben descifrar los admins creados con la llave local.
  vercelEnv('KAZERO_TOTP_KEY', 'preview', llaveTotp);
  ghSecret('DATABASE_URL_OWNER', 'preview', owner);
} else {
  vercelEnv('DATABASE_URL', 'production', app);
  vercelEnv('KAZERO_TOTP_KEY', 'production', llaveTotp);
  ghSecret('DATABASE_URL_OWNER', 'production', owner);
  // Variable de repo (no secreto: es un hostname). La leen las migraciones de preview y de producción
  // en CI (vars.KAZERO_HOST_PROD) para que la guarda reconozca producción.
  ejecutar('gh', ['variable', 'set', 'KAZERO_HOST_PROD'], hostNormalizado(owner));
  console.log('  ✓ GitHub variable de repo: KAZERO_HOST_PROD');

  // El admin se crea aquí, con la llave TOTP aún en memoria: Vercel no vuelve a mostrar valores Sensitive
  // y así la llave de producción nunca toca el disco.
  const rl = createInterface({ input: stdin, output: stdout });
  const email = (await rl.question('\nCorreo del admin de producción: ')).trim();
  const password = await rl.question(
    'Contraseña (mín. 12; se verá al teclear, limpia la terminal después): ',
  );
  rl.close();
  const a = await conDbUrl(owner, (db) => crearAdmin(db, { email, password }, llaveTotp));
  console.log('\nAgrega esta cuenta en tu app autenticadora (Google Authenticator, 1Password, etc.):');
  console.log(`  ${a.uriTotp}`);
  console.log('\nCódigos de recuperación (guárdalos fuera de la computadora; cada uno sirve una vez):');
  for (const c of a.codigosRecuperacion) console.log(`  ${c}`);
  console.log('\nEsta es la única vez que se muestran. Limpia la terminal (cls / clear).');
}
console.log('[bd:configurar] Listo. Ningún valor de conexión se imprimió.');
