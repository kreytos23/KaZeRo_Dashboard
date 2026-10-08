import { execFileSync } from 'node:child_process';

const ES_WINDOWS = process.platform === 'win32';

/**
 * Llama al CLI `neon` local (devDependency). Localmente usa el login OAuth y el contexto de `.neon`.
 * En CI usa NEON_API_KEY y NEON_PROJECT_ID. La salida se captura y NUNCA se imprime: puede traer credenciales.
 */
function neon(args: string[]): string {
  const proyecto = process.env.NEON_PROJECT_ID ? ['--project-id', process.env.NEON_PROJECT_ID] : [];
  return execFileSync(ES_WINDOWS ? 'pnpm.cmd' : 'pnpm', ['exec', 'neon', ...args, ...proyecto], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    // En Windows, los .cmd requieren shell (Node ≥ 20 rechaza spawn de .cmd sin ella). Los args son fijos.
    shell: ES_WINDOWS,
  });
}

export function crearRama(nombre: string, padre: string, horasDeVida: number): void {
  const expira = new Date(Date.now() + horasDeVida * 3_600_000).toISOString();
  neon([
    'branches',
    'create',
    '--name',
    nombre,
    '--parent',
    padre,
    '--expires-at',
    expira,
    '--output',
    'json',
  ]);
}

export function borrarRama(nombre: string): void {
  neon(['branches', 'delete', nombre]);
}

export function cadenaConexion(rama: string, opciones: { pooled?: boolean } = {}): string {
  const args = ['connection-string', rama, '--role-name', 'neondb_owner', '--database-name', 'neondb'];
  if (opciones.pooled) args.push('--pooled');
  return neon(args).trim();
}
