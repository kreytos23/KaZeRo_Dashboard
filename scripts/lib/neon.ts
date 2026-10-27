import { execFileSync } from 'node:child_process';

const ES_WINDOWS = process.platform === 'win32';

/**
 * Llama al CLI `neon` local (devDependency). Localmente usa el login OAuth y el contexto de `.neon`.
 * En CI usa NEON_API_KEY y NEON_PROJECT_ID. La salida se captura y NUNCA se imprime: puede traer credenciales.
 */
function neon(args: string[]): string {
  const proyecto = process.env.NEON_PROJECT_ID ? ['--project-id', process.env.NEON_PROJECT_ID] : [];
  try {
    return execFileSync(ES_WINDOWS ? 'pnpm.cmd' : 'pnpm', ['exec', 'neon', ...args, ...proyecto], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      // En Windows, los .cmd requieren shell (Node ≥ 20 rechaza spawn de .cmd sin ella). Los args son fijos.
      shell: ES_WINDOWS,
    });
  } catch (err) {
    // El error original lleva stdout (en connection-string, la cadena con contraseña) y los logs de
    // Actions son públicos: se relanza uno nuevo sin stdout, stderr ni cause.
    const status = (err as { status?: unknown }).status ?? 'desconocido';
    throw new Error(`neon ${args[0]} ${args[1] ?? ''} falló (status ${String(status)})`);
  }
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

/** Cuántas ramas tiene el proyecto ahora (para respetar el límite del plan antes de crear más). */
export function contarRamas(): number {
  const lista = JSON.parse(neon(['branches', 'list', '--output', 'json'])) as unknown;
  return Array.isArray(lista) ? lista.length : 0;
}

/** Nombres de las ramas del proyecto (sin credenciales). */
export function listarRamas(): string[] {
  const lista = JSON.parse(neon(['branches', 'list', '--output', 'json'])) as unknown;
  return Array.isArray(lista) ? lista.map((r: { name?: unknown }) => String(r.name)) : [];
}

export interface RamaNeon {
  id: string;
  name: string;
  parentId: string | null;
  /** ISO 8601, tal como lo entrega Neon. */
  createdAt: string | null;
}

/** Ramas del proyecto con su padre y fecha de creación (sin credenciales). */
export function listarRamasDetalle(): RamaNeon[] {
  const lista = JSON.parse(neon(['branches', 'list', '--output', 'json'])) as unknown;
  if (!Array.isArray(lista)) return [];
  return lista.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    name: String(r.name),
    parentId: typeof r.parent_id === 'string' ? r.parent_id : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : null,
  }));
}
