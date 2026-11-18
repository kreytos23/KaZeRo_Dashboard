import { and, asc, eq, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { cliente, vCliente } from '@/db/schema';
import { calcularCambios } from '@/domain/auditoria';
import { parsearFechaISO } from '@/domain/fechas';
import { escaparLike, normalizar } from '@/domain/texto';
import { fijarContextoAuditoria, motivoPara } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio, conflictoVersion } from '@/server/errores';
import { MSG_PREVIAS_RANGO } from './mensajes';

export interface DatosCliente {
  nombre: string;
  referencia?: string | null;
  telefono?: string | null;
  cumpleanos?: string | null;
  redSocial?: string | null;
  usuarioRed?: string | null;
  vendedorHabitualId?: string | null;
  notas?: string;
  /** L-1: 0–9. Sin valor = no se cambia (en el alta, 0). */
  comprasPrevias?: number;
}

const opcional = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

function validar(d: DatosCliente) {
  const nombre = d.nombre.trim().replace(/\s+/g, ' ');
  if (!nombre || nombre.length > 120)
    throw new ErrorNegocio('cliente_invalido', 'El nombre debe tener entre 1 y 120 caracteres.', 'nombre');
  let cumpleanos: string | null = null;
  if (opcional(d.cumpleanos)) {
    cumpleanos = parsearFechaISO(d.cumpleanos!);
    if (!cumpleanos)
      throw new ErrorNegocio('cliente_invalido', 'La fecha de cumpleaños no es válida.', 'cumpleanos');
  }
  const previas = d.comprasPrevias;
  if (previas !== undefined && !(Number.isInteger(previas) && previas >= 0 && previas <= 9))
    throw new ErrorNegocio('cliente_invalido', MSG_PREVIAS_RANGO, 'comprasPrevias');
  return {
    nombre,
    referencia: opcional(d.referencia),
    telefono: opcional(d.telefono),
    cumpleanos,
    redSocial: opcional(d.redSocial),
    usuarioRed: opcional(d.usuarioRed),
    vendedorHabitualId: opcional(d.vendedorHabitualId),
    notas: (d.notas ?? '').trim(),
    comprasPrevias: previas,
  };
}

export function crearCliente(db: Ejecutor, d: DatosCliente): Promise<string> {
  // El alta siempre empieza en 0 compras previas: corregirlas exige motivo y queda auditado (solo en UPDATE).
  const valores = { ...validar(d), comprasPrevias: undefined };
  return conErroresDeNegocio(async () => {
    const [c] = await db.insert(cliente).values(valores).returning({ id: cliente.id });
    return c!.id;
  });
}

export function actualizarCliente(
  db: Ejecutor,
  d: { id: string; version: number; adminId: string; motivo?: string | null } & DatosCliente,
): Promise<{ cambios: number }> {
  const v = validar(d);
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const [actual] = await tx
        .select({
          version: cliente.version,
          nombre: cliente.nombre,
          referencia: cliente.referencia,
          telefono: cliente.telefono,
          cumpleanos: cliente.cumpleanos,
          redSocial: cliente.redSocial,
          usuarioRed: cliente.usuarioRed,
          vendedorHabitualId: cliente.vendedorHabitualId,
          notas: cliente.notas,
          comprasPrevias: cliente.comprasPrevias,
        })
        .from(cliente)
        .where(eq(cliente.id, d.id))
        .for('no key update');
      if (!actual) throw new ErrorNegocio('no_encontrado', 'El cliente no existe.');
      if (actual.version !== d.version) throw conflictoVersion();
      const nuevo = { ...v, comprasPrevias: v.comprasPrevias ?? actual.comprasPrevias };
      const fila = (x: typeof actual | typeof nuevo) => ({
        nombre: x.nombre,
        referencia: x.referencia,
        telefono: x.telefono,
        cumpleanos: x.cumpleanos,
        red_social: x.redSocial,
        usuario_red: x.usuarioRed,
        vendedor_habitual_id: x.vendedorHabitualId,
        notas: x.notas,
        compras_previas: String(x.comprasPrevias),
      });
      const cambios = calcularCambios(fila(actual), fila(nuevo));
      if (cambios.length === 0) return { cambios: 0 };
      await fijarContextoAuditoria(tx, {
        adminId: d.adminId,
        motivo: motivoPara('cliente', cambios, d.motivo),
      });
      const filas = await tx
        .update(cliente)
        .set({ ...nuevo, version: sql`${cliente.version} + 1` })
        .where(and(eq(cliente.id, d.id), eq(cliente.version, d.version)))
        .returning({ id: cliente.id });
      if (filas.length === 0) throw conflictoVersion();
      return { cambios: cambios.length };
    }),
  );
}

// Lecturas por la vista v_cliente (ya trae el nombre del vendedor habitual: sin consulta extra por fila).
export async function obtenerCliente(db: Ejecutor, id: string) {
  const [c] = await db.select().from(vCliente).where(eq(vCliente.id, id)).limit(1);
  return c ?? null;
}

/** Mismo WHERE para listar y contar: sin «Venta de mostrador» y, si hay `q`, el filtro trigram. */
function condicionesClientes(qBruto: string | undefined) {
  const q = normalizar(qBruto ?? '');
  // ESCAPE '\': en esta plantilla JS '\\' llega a SQL como una sola barra (lecciones §2).
  // La expresión coincide con el índice trigram cliente_busqueda_trgm (la vista se expande en el plan).
  const filtro = q
    ? sql`kz_normalizar(${vCliente.nombre} || ' ' || coalesce(${vCliente.referencia}, '')) LIKE ${'%' + escaparLike(q) + '%'} ESCAPE '\\'`
    : undefined;
  // «Venta de mostrador» no es una clienta de verdad: no se lista (sus notas se ven desde el exhibidor).
  return and(eq(vCliente.esMostrador, false), filtro);
}

export function listarClientes(db: Ejecutor, o: { q?: string; limite?: number; offset?: number } = {}) {
  return db
    .select()
    .from(vCliente)
    .where(condicionesClientes(o.q))
    .orderBy(asc(vCliente.nombre))
    .limit(Math.min(o.limite ?? 50, 200))
    .offset(Math.max(Math.trunc(o.offset ?? 0), 0));
}

export async function contarClientes(db: Ejecutor, o: { q?: string } = {}): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vCliente)
    .where(condicionesClientes(o.q));
  return r?.n ?? 0;
}
export type ClienteFila = Awaited<ReturnType<typeof listarClientes>>[number];
