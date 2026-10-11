import { and, asc, eq, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { vVendedor, vendedor } from '@/db/schema';
import { ErrorNegocio, conErroresDeNegocio, conflictoVersion } from '@/server/errores';

export type TipoVendedor = 'casa' | 'revendedora' | 'consignacion';
export interface VendedorFila {
  id: string;
  nombre: string;
  tipo: TipoVendedor;
  comisionPct: string;
  activo: boolean;
  version: number;
}

// Lecturas por la vista v_vendedor; la tabla solo se toca para escribir.
const columnas = {
  id: vVendedor.id,
  nombre: vVendedor.nombre,
  tipo: vVendedor.tipo,
  comisionPct: vVendedor.comisionPct,
  activo: vVendedor.activo,
  version: vVendedor.version,
};

function nombreValido(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (!limpio || limpio.length > 80)
    throw new ErrorNegocio('vendedor_invalido', 'El nombre debe tener entre 1 y 80 caracteres.');
  return limpio;
}

export function crearVendedor(
  db: Ejecutor,
  d: { nombre: string; tipo: TipoVendedor; comisionPct: string },
): Promise<string> {
  const nombre = nombreValido(d.nombre);
  return conErroresDeNegocio(async () => {
    const [v] = await db
      .insert(vendedor)
      .values({ nombre, tipo: d.tipo, comisionPct: d.comisionPct })
      .returning({ id: vendedor.id });
    return v!.id;
  });
}

export function actualizarVendedor(
  db: Ejecutor,
  d: {
    id: string;
    version: number;
    nombre: string;
    tipo: TipoVendedor;
    comisionPct: string;
    activo: boolean;
  },
): Promise<void> {
  const nombre = nombreValido(d.nombre);
  return conErroresDeNegocio(async () => {
    const filas = await db
      .update(vendedor)
      .set({
        nombre,
        tipo: d.tipo,
        comisionPct: d.comisionPct,
        activo: d.activo,
        version: sql`${vendedor.version} + 1`,
      })
      .where(and(eq(vendedor.id, d.id), eq(vendedor.version, d.version)))
      .returning({ id: vendedor.id });
    if (filas.length === 0) throw conflictoVersion();
  });
}

export function listarVendedores(db: Ejecutor, o: { soloActivos?: boolean } = {}): Promise<VendedorFila[]> {
  return db
    .select(columnas)
    .from(vVendedor)
    .where(o.soloActivos ? eq(vVendedor.activo, true) : undefined)
    .orderBy(asc(vVendedor.nombre));
}

export async function obtenerVendedor(db: Ejecutor, id: string): Promise<VendedorFila | null> {
  const [v] = await db.select(columnas).from(vVendedor).where(eq(vVendedor.id, id)).limit(1);
  return v ?? null;
}
