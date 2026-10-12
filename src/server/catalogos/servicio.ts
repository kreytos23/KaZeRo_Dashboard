import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { categoria, material, proveedor, vCatalogo } from '@/db/schema';
import { calcularCambios } from '@/domain/auditoria';
import { normalizar } from '@/domain/texto';
import { fijarContextoAuditoria, motivoPara } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio, conflictoVersion } from '@/server/errores';

export type TipoCatalogo = 'categoria' | 'material' | 'proveedor';

// Las tres tablas tienen la misma forma; se usa el tipo de una para que Drizzle acepte cualquiera.
const TABLAS = { categoria, material, proveedor } as unknown as Record<TipoCatalogo, typeof categoria>;

// Misma clase de espacios que normalizar(): así normalizar(limpiar(x)) === normalizar(x).
const ESPACIOS = /[ \t\n\r\f\v\u00A0]+/g;
function limpiar(nombre: string): string {
  const limpio = nombre.replace(ESPACIOS, ' ').replace(/^ | $/g, '');
  if (!limpio || limpio.length > 80) {
    throw new ErrorNegocio('catalogo_invalido', 'El nombre debe tener entre 1 y 80 caracteres.', 'nombre');
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
    .select({ id: vCatalogo.id, nombre: vCatalogo.nombre, version: vCatalogo.version })
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

/** D6: renombra con bloqueo optimista. La unicidad la da el índice kz_normalizar (→ "Ese material ya existe."). */
export function renombrarCatalogo(
  db: Ejecutor,
  d: {
    tipo: TipoCatalogo;
    id: string;
    version: number;
    adminId: string;
    motivo?: string | null;
    nombre: string;
  },
): Promise<{ cambios: number }> {
  const nombre = limpiar(d.nombre);
  const t = TABLAS[d.tipo];
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      // NO KEY UPDATE: el alta de piezas toma KEY SHARE sobre el catálogo por la FK.
      const [actual] = await tx
        .select({ version: t.version, nombre: t.nombre })
        .from(t)
        .where(eq(t.id, d.id))
        .for('no key update');
      if (!actual) throw new ErrorNegocio('no_encontrado', 'Registro no encontrado.');
      if (actual.version !== d.version) throw conflictoVersion();
      const cambios = calcularCambios({ nombre: actual.nombre }, { nombre });
      if (cambios.length === 0) return { cambios: 0 };
      await fijarContextoAuditoria(tx, {
        adminId: d.adminId,
        motivo: motivoPara(d.tipo, cambios, d.motivo),
      });
      const filas = await tx
        .update(t)
        .set({ nombre, version: sql`${t.version} + 1` })
        .where(and(eq(t.id, d.id), eq(t.version, d.version)))
        .returning({ id: t.id });
      if (filas.length === 0) throw conflictoVersion();
      return { cambios: cambios.length };
    }),
  );
}
