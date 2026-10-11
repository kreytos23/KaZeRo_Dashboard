import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { categoria, material, proveedor, vCatalogo } from '@/db/schema';
import { normalizar } from '@/domain/texto';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';

export type TipoCatalogo = 'categoria' | 'material' | 'proveedor';

// Las tres tablas tienen la misma forma; se usa el tipo de una para que Drizzle acepte cualquiera.
const TABLAS = { categoria, material, proveedor } as unknown as Record<TipoCatalogo, typeof categoria>;

function limpiar(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (!limpio || limpio.length > 80) {
    throw new ErrorNegocio('catalogo_invalido', 'El nombre debe tener entre 1 y 80 caracteres.');
  }
  return limpio;
}

// Flujo de escritura: se consulta la tabla (no la vista) justo antes de insertar.
async function buscar(db: Ejecutor, tipo: TipoCatalogo, nombre: string) {
  const t = TABLAS[tipo];
  const [fila] = await db
    .select({ id: t.id })
    .from(t)
    .where(sql`kz_normalizar(${t.nombre}) = kz_normalizar(${nombre})`)
    .limit(1);
  return fila?.id ?? null;
}

/** Lectura: por la vista v_catalogo. */
export function listarCatalogo(db: Ejecutor, tipo: TipoCatalogo) {
  return db
    .select({ id: vCatalogo.id, nombre: vCatalogo.nombre })
    .from(vCatalogo)
    .where(eq(vCatalogo.tipo, tipo))
    .orderBy(asc(vCatalogo.nombre));
}

/** Para el alta individual: reutiliza el catálogo existente (normalizado) o lo crea. */
export async function obtenerOCrearCatalogo(
  db: Ejecutor,
  tipo: TipoCatalogo,
  nombre: string,
): Promise<string> {
  const limpio = limpiar(nombre);
  const existente = await buscar(db, tipo, limpio);
  if (existente) return existente;
  const t = TABLAS[tipo];
  const [nuevo] = await db.insert(t).values({ nombre: limpio }).onConflictDoNothing().returning({ id: t.id });
  if (nuevo) return nuevo.id;
  // Otra transacción lo creó entre el SELECT y el INSERT.
  return (await buscar(db, tipo, limpio))!;
}

/**
 * Para el alta por lote, sin N+1: un INSERT de varias filas (ON CONFLICT DO NOTHING ignora los ya
 * existentes) y un SELECT de vuelta. Devuelve normalizado → id; normalizar() coincide con kz_normalizar.
 */
export async function resolverCatalogos(
  db: Ejecutor,
  tipo: TipoCatalogo,
  nombres: readonly string[],
): Promise<Map<string, string>> {
  const porClave = new Map<string, string>();
  for (const n of nombres) {
    const limpio = limpiar(n);
    const clave = normalizar(limpio);
    if (!porClave.has(clave)) porClave.set(clave, limpio);
  }
  if (porClave.size === 0) return new Map();
  const t = TABLAS[tipo];
  await db
    .insert(t)
    .values([...porClave.values()].map((nombre) => ({ nombre })))
    .onConflictDoNothing();
  const filas = await db
    .select({ id: t.id, nombre: t.nombre })
    .from(t)
    .where(inArray(sql`kz_normalizar(${t.nombre})`, [...porClave.keys()]));
  return new Map(filas.map((f) => [normalizar(f.nombre), f.id]));
}

export function crearCatalogo(db: Ejecutor, tipo: TipoCatalogo, nombre: string): Promise<string> {
  const limpio = limpiar(nombre);
  return conErroresDeNegocio(async () => {
    const t = TABLAS[tipo];
    const [nuevo] = await db.insert(t).values({ nombre: limpio }).returning({ id: t.id });
    return nuevo!.id;
  });
}
