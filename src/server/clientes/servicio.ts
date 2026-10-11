import { and, asc, eq, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { cliente, vCliente } from '@/db/schema';
import { parsearFechaISO } from '@/domain/fechas';
import { escaparLike, normalizar } from '@/domain/texto';
import { ErrorNegocio, conErroresDeNegocio, conflictoVersion } from '@/server/errores';

export interface DatosCliente {
  nombre: string;
  referencia?: string | null;
  telefono?: string | null;
  cumpleanos?: string | null;
  redSocial?: string | null;
  usuarioRed?: string | null;
  vendedorHabitualId?: string | null;
  notas?: string;
}

const opcional = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

function validar(d: DatosCliente) {
  const nombre = d.nombre.trim().replace(/\s+/g, ' ');
  if (!nombre || nombre.length > 120)
    throw new ErrorNegocio('cliente_invalido', 'El nombre debe tener entre 1 y 120 caracteres.');
  let cumpleanos: string | null = null;
  if (opcional(d.cumpleanos)) {
    cumpleanos = parsearFechaISO(d.cumpleanos!);
    if (!cumpleanos) throw new ErrorNegocio('cliente_invalido', 'La fecha de cumpleaños no es válida.');
  }
  return {
    nombre,
    referencia: opcional(d.referencia),
    telefono: opcional(d.telefono),
    cumpleanos,
    redSocial: opcional(d.redSocial),
    usuarioRed: opcional(d.usuarioRed),
    vendedorHabitualId: opcional(d.vendedorHabitualId),
    notas: (d.notas ?? '').trim(),
  };
}

export function crearCliente(db: Ejecutor, d: DatosCliente): Promise<string> {
  const valores = validar(d);
  return conErroresDeNegocio(async () => {
    const [c] = await db.insert(cliente).values(valores).returning({ id: cliente.id });
    return c!.id;
  });
}

export function actualizarCliente(
  db: Ejecutor,
  d: { id: string; version: number } & DatosCliente,
): Promise<void> {
  const valores = validar(d);
  return conErroresDeNegocio(async () => {
    const filas = await db
      .update(cliente)
      .set({ ...valores, version: sql`${cliente.version} + 1` })
      .where(and(eq(cliente.id, d.id), eq(cliente.version, d.version)))
      .returning({ id: cliente.id });
    if (filas.length === 0) throw conflictoVersion();
  });
}

// Lecturas por la vista v_cliente (ya trae el nombre del vendedor habitual: sin consulta extra por fila).
export async function obtenerCliente(db: Ejecutor, id: string) {
  const [c] = await db.select().from(vCliente).where(eq(vCliente.id, id)).limit(1);
  return c ?? null;
}

export function listarClientes(db: Ejecutor, o: { q?: string; limite?: number } = {}) {
  const q = normalizar(o.q ?? '');
  // ESCAPE '\': en esta plantilla JS '\\' llega a SQL como una sola barra (lecciones §2).
  // La expresión coincide con el índice trigram cliente_busqueda_trgm (la vista se expande en el plan).
  const filtro = q
    ? sql`kz_normalizar(${vCliente.nombre} || ' ' || coalesce(${vCliente.referencia}, '')) LIKE ${'%' + escaparLike(q) + '%'} ESCAPE '\\'`
    : undefined;
  return db
    .select()
    .from(vCliente)
    .where(filtro)
    .orderBy(asc(vCliente.nombre))
    .limit(Math.min(o.limite ?? 50, 200));
}
export type ClienteFila = Awaited<ReturnType<typeof listarClientes>>[number];
