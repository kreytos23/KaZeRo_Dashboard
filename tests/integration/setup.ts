import { afterAll, vi } from 'vitest';
import { archivoRamaTrabajador, verificarRamaPrueba } from '../../scripts/lib/rama-prueba';

/**
 * scripts/test-neon.ts crea una rama Neon por worker de Vitest y las pasa en KAZERO_RAMAS_PRUEBA.
 * Cada worker elige la suya por VITEST_POOL_ID (1..N) y NUNCA toca otra: la guarda de siempre
 * (verificarRamaPrueba) se aplica a la rama elegida, con su archivo de registro propio.
 */
function asignarRamaDelWorker() {
  const lista = JSON.parse(process.env.KAZERO_RAMAS_PRUEBA ?? '[]') as {
    rama: string;
    owner: string;
    app: string;
  }[];
  const id = Number(process.env.VITEST_POOL_ID);
  if (!Number.isInteger(id) || id < 1 || id > lista.length) {
    throw new Error(
      `Worker ${process.env.VITEST_POOL_ID ?? '?'} sin rama de prueba asignada (hay ${lista.length}). ` +
        'Las pruebas de integración solo corren con `pnpm test:integracion`.',
    );
  }
  const r = lista[id - 1]!;
  process.env.DATABASE_URL = r.app;
  process.env.DATABASE_URL_OWNER = r.owner;
  process.env.KAZERO_RAMA_PRUEBA = r.rama;
  verificarRamaPrueba(process.env, archivoRamaTrabajador(id - 1));
}
asignarRamaDelWorker();

/**
 * Un Pool por URL durante todo el archivo (en producción `conDbUrl` sigue creando uno por llamada).
 * Abrir un WebSocket nuevo por fixture/consulta era el mayor gasto de tiempo. Cada consulta suelta toma
 * su propio cliente del pool (máx. 10) y cada transacción conserva el suyo, así que las carreras
 * siguen usando sesiones distintas. Los `SET` de sesión están prohibidos en las pruebas (solo SET LOCAL
 * / set_config(..., true)) para que ninguna conexión reutilizada arrastre estado a otra prueba.
 */
const reutilizados = vi.hoisted(() => new Map<string, { end: () => Promise<void> }>());

vi.mock('@/db/pool', async (original) => {
  const real = await original<typeof import('@/db/pool')>();
  const { Pool } = await import('@neondatabase/serverless');
  const { drizzle } = await import('drizzle-orm/neon-serverless');
  const schema = await import('@/db/schema');
  return {
    ...real,
    conDbUrl: async <T>(url: string, fn: (db: import('@/db/pool').Db) => Promise<T>): Promise<T> => {
      let entrada = reutilizados.get(url) as
        { end: () => Promise<void>; db: import('@/db/pool').Db } | undefined;
      if (!entrada) {
        const pool = new Pool({ connectionString: url });
        pool.on('error', () => {}); // un cliente inactivo cerrado por el servidor no debe tumbar el proceso
        entrada = { end: () => pool.end(), db: drizzle({ client: pool, schema }) };
        reutilizados.set(url, entrada);
      }
      return fn(entrada.db);
    },
  };
});

afterAll(async () => {
  const todos = [...reutilizados.values()];
  reutilizados.clear();
  await Promise.all(todos.map((e) => e.end()));
});
