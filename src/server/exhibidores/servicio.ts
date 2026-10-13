import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { exhibidor, movimientoPieza, pieza, vExhibidor, vPieza, vendedor } from '@/db/schema';
import { normalizarCodigo } from '@/domain/codigos';
import { calcularCambios } from '@/domain/auditoria';
import { parsearFechaISO } from '@/domain/fechas';
import { fijarContextoAuditoria, motivoPara } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio, conflictoVersion } from '@/server/errores';
import { apartadasDeExhibidor } from '@/server/pedidos/lecturas';

const MAX_CODIGOS = 500;

// Lecturas por la vista v_exhibidor: piezas_actuales es un agregado de la vista (sin consulta por fila).
export type ExhibidorResumen = {
  id: string;
  nombre: string;
  fechaEnvio: string;
  estado: 'abierto' | 'cerrado';
  version: number;
  vendedorId: string;
  vendedorNombre: string;
  piezasActuales: number;
  piezasApartadas: number;
};

function datosValidos(d: { nombre: string; fechaEnvio: string }) {
  const nombre = d.nombre.trim();
  if (!nombre || nombre.length > 120)
    throw new ErrorNegocio('exhibidor_invalido', 'El nombre debe tener entre 1 y 120 caracteres.', 'nombre');
  const fechaEnvio = parsearFechaISO(d.fechaEnvio);
  if (!fechaEnvio)
    throw new ErrorNegocio('exhibidor_invalido', 'La fecha de envío no es válida.', 'fechaEnvio');
  return { nombre, fechaEnvio };
}

/** D5: solo nombre y fecha de envío, y solo mientras está abierto (uno cerrado es registro histórico). */
export async function editarExhibidor(
  db: Ejecutor,
  d: {
    exhibidorId: string;
    version: number;
    adminId: string;
    motivo?: string | null;
    nombre: string;
    fechaEnvio: string;
  },
): Promise<{ cambios: number }> {
  const v = datosValidos(d);
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const [actual] = await tx
        .select({
          estado: exhibidor.estado,
          version: exhibidor.version,
          nombre: exhibidor.nombre,
          fechaEnvio: exhibidor.fechaEnvio,
        })
        .from(exhibidor)
        .where(eq(exhibidor.id, d.exhibidorId))
        .for('no key update'); // ver el comentario de `bloquear`
      if (!actual) throw new ErrorNegocio('no_encontrado', 'El exhibidor no existe.');
      // Primero la versión: un cliente con datos viejos debe ver el conflicto, no "cerrado".
      if (actual.version !== d.version) throw conflictoVersion();
      if (actual.estado === 'cerrado')
        throw new ErrorNegocio('exhibidor_cerrado', 'Un exhibidor cerrado ya no se edita.');
      const cambios = calcularCambios(
        { nombre: actual.nombre, fecha_envio: actual.fechaEnvio },
        { nombre: v.nombre, fecha_envio: v.fechaEnvio },
      );
      if (cambios.length === 0) return { cambios: 0 };
      await fijarContextoAuditoria(tx, {
        adminId: d.adminId,
        motivo: motivoPara('exhibidor', cambios, d.motivo),
      });
      const filas = await tx
        .update(exhibidor)
        .set({ ...v, version: sql`${exhibidor.version} + 1` })
        .where(and(eq(exhibidor.id, d.exhibidorId), eq(exhibidor.version, d.version)))
        .returning({ id: exhibidor.id });
      if (filas.length === 0) throw conflictoVersion();
      return { cambios: cambios.length };
    }),
  );
}

export async function crearExhibidor(
  db: Ejecutor,
  d: { vendedorId: string; nombre: string; fechaEnvio: string },
): Promise<string> {
  const { nombre, fechaEnvio } = datosValidos(d);
  return conErroresDeNegocio(async () => {
    const [e] = await db
      .insert(exhibidor)
      .values({ vendedorId: d.vendedorId, nombre, fechaEnvio })
      .returning({ id: exhibidor.id });
    return e!.id;
  });
}

/** Normaliza y valida la lista antes de tocar la BD: no vacía, sin repetidos, con tope. */
function codigosValidos(codigos: string[]): string[] {
  const lista = codigos.map(normalizarCodigo).filter(Boolean);
  if (lista.length === 0) throw new ErrorNegocio('sin_codigos', 'Escribe al menos un código.', 'codigos');
  if (lista.length > MAX_CODIGOS)
    throw new ErrorNegocio('sin_codigos', `Máximo ${MAX_CODIGOS} piezas por operación.`, 'codigos');
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const c of lista) (vistos.has(c) ? repetidos : vistos).add(c);
  if (repetidos.size)
    throw new ErrorNegocio(
      'codigos_repetidos',
      `Códigos repetidos: ${[...repetidos].join(', ')}.`,
      'codigos',
    );
  return lista;
}

/**
 * Orden de bloqueo fijo (exhibidor → piezas por id). Dos consultas en total.
 *
 * El exhibidor se bloquea con NO KEY UPDATE y no con UPDATE: `cambiarEstado` (piezas) bloquea una pieza
 * y luego inserta un movimiento con exhibidor_id, cuya FK toma FOR KEY SHARE sobre el exhibidor. Con
 * FOR UPDATE: A (cambiarEstado) tiene la pieza P y espera al exhibidor X; B (regresarPiezas) tiene X y
 * espera P → interbloqueo (40P01). NO KEY UPDATE no choca con KEY SHARE, pero sigue serializando
 * enviar / regresar / cerrar entre sí.
 *
 * enviar y regresar NO suben exhibidor.version a propósito: el resumen de piezas es derivado y
 * `cerrarExhibidor` vuelve a contar bajo este mismo bloqueo.
 * La fila del vendedor no se bloquea: una desactivación concurrente puede dejar pasar un envío (aceptado).
 * Futuro servicio de pedidos: la transición apartada → en_exhibidor debe bloquear el exhibidor
 * igual (NO KEY UPDATE) y rechazar si está cerrado.
 */
async function bloquear(tx: Ejecutor, exhibidorId: string, codigos: string[]) {
  const [e] = await tx
    .select({ estado: exhibidor.estado, vendedorActivo: vendedor.activo })
    .from(exhibidor)
    .innerJoin(vendedor, eq(vendedor.id, exhibidor.vendedorId))
    .where(eq(exhibidor.id, exhibidorId))
    .for('no key update', { of: exhibidor });
  if (!e) throw new ErrorNegocio('no_encontrado', 'El exhibidor no existe.');
  const piezas = await tx
    .select({
      id: pieza.id,
      codigo: pieza.codigo,
      estado: pieza.estado,
      exhibidorId: pieza.exhibidorId,
    })
    .from(pieza)
    .where(inArray(pieza.codigo, codigos))
    .orderBy(asc(pieza.id))
    .for('update');
  const encontrados = new Set(piezas.map((p) => p.codigo));
  // Los mensajes listan los códigos en el orden en que se escribieron (los ids son uuid aleatorios).
  const orden = new Map(codigos.map((c, i) => [c, i]));
  const porEscritura = <T extends { codigo: string }>(xs: T[]) =>
    [...xs].sort((a, b) => orden.get(a.codigo)! - orden.get(b.codigo)!);
  return {
    ...e,
    piezas,
    porEscritura,
    faltantes: codigos.filter((c) => !encontrados.has(c)),
  };
}

export async function enviarPiezas(
  db: Ejecutor,
  d: { exhibidorId: string; codigos: string[] },
): Promise<{ enviadas: number }> {
  const codigos = codigosValidos(d.codigos);
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const { estado, vendedorActivo, piezas, porEscritura, faltantes } = await bloquear(
        tx,
        d.exhibidorId,
        codigos,
      );
      if (estado === 'cerrado') throw new ErrorNegocio('exhibidor_cerrado', 'El exhibidor está cerrado.');
      if (!vendedorActivo)
        throw new ErrorNegocio('vendedor_inactivo', 'El vendedor del exhibidor está inactivo.');
      const noDisponibles = porEscritura(piezas.filter((p) => p.estado !== 'disponible'));
      if (faltantes.length || noDisponibles.length) {
        const partes = ['No se envió nada.'];
        if (faltantes.length) partes.push(`No existen: ${faltantes.join(', ')}.`);
        if (noDisponibles.length)
          partes.push(
            `No están disponibles: ${noDisponibles.map((p) => `${p.codigo} (${p.estado})`).join(', ')}.`,
          );
        throw new ErrorNegocio('envio_rechazado', partes.join(' '));
      }
      const ids = piezas.map((p) => p.id);
      await tx
        .update(pieza)
        .set({
          estado: 'en_exhibidor',
          exhibidorId: d.exhibidorId,
          version: sql`${pieza.version} + 1`,
        })
        .where(inArray(pieza.id, ids));
      await tx.insert(movimientoPieza).values(
        ids.map((piezaId) => ({
          piezaId,
          tipo: 'envio_exhibidor' as const,
          deEstado: 'disponible' as const,
          aEstado: 'en_exhibidor' as const,
          exhibidorId: d.exhibidorId,
        })),
      );
      return { enviadas: ids.length };
    }),
  );
}

export async function regresarPiezas(
  db: Ejecutor,
  d: { exhibidorId: string; codigos: string[] },
): Promise<{ regresadas: number }> {
  const codigos = codigosValidos(d.codigos);
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const { piezas, porEscritura, faltantes } = await bloquear(tx, d.exhibidorId, codigos);
      const ajenas = porEscritura(
        piezas.filter((p) => p.estado !== 'en_exhibidor' || p.exhibidorId !== d.exhibidorId),
      );
      if (faltantes.length || ajenas.length) {
        const partes = ['No se regresó nada.'];
        if (faltantes.length) partes.push(`No existen: ${faltantes.join(', ')}.`);
        if (ajenas.length)
          partes.push(`No están en este exhibidor: ${ajenas.map((p) => p.codigo).join(', ')}.`);
        throw new ErrorNegocio('regreso_rechazado', partes.join(' '));
      }
      const ids = piezas.map((p) => p.id);
      await tx
        .update(pieza)
        .set({ estado: 'disponible', exhibidorId: null, version: sql`${pieza.version} + 1` })
        .where(inArray(pieza.id, ids));
      await tx.insert(movimientoPieza).values(
        ids.map((piezaId) => ({
          piezaId,
          tipo: 'regreso' as const,
          deEstado: 'en_exhibidor' as const,
          aEstado: 'disponible' as const,
          exhibidorId: d.exhibidorId,
        })),
      );
      return { regresadas: ids.length };
    }),
  );
}

export async function cerrarExhibidor(
  db: Ejecutor,
  d: { exhibidorId: string; version: number },
): Promise<void> {
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const [e] = await tx
        .select({ version: exhibidor.version })
        .from(exhibidor)
        .where(eq(exhibidor.id, d.exhibidorId))
        .for('no key update'); // ver el comentario de `bloquear`
      if (!e) throw new ErrorNegocio('no_encontrado', 'El exhibidor no existe.');
      if (e.version !== d.version) throw conflictoVersion();
      // Cualquier pieza ligada (en exhibidor o apartada) impide cerrarlo.
      const ligadas = await tx
        .select({ estado: pieza.estado, n: count() })
        .from(pieza)
        .where(eq(pieza.exhibidorId, d.exhibidorId))
        .groupBy(pieza.estado);
      const nEn = ligadas.find((l) => l.estado === 'en_exhibidor')?.n ?? 0;
      const nApartadas = ligadas.find((l) => l.estado === 'apartada')?.n ?? 0;
      if (nEn + nApartadas > 0) {
        const partes: string[] = [];
        if (nEn) partes.push(`Regresa o vende ${nEn} ${nEn === 1 ? 'pieza' : 'piezas'} antes de cerrarlo.`);
        if (nApartadas)
          partes.push(
            nApartadas === 1
              ? 'Tiene 1 pieza apartada pendiente de pedido.'
              : `Tiene ${nApartadas} piezas apartadas pendientes de pedido.`,
          );
        throw new ErrorNegocio('exhibidor_con_piezas', partes.join(' '));
      }
      const filas = await tx
        .update(exhibidor)
        .set({ estado: 'cerrado', cerradoAt: new Date(), version: sql`${exhibidor.version} + 1` })
        .where(and(eq(exhibidor.id, d.exhibidorId), eq(exhibidor.version, d.version)))
        .returning({ id: exhibidor.id });
      if (filas.length === 0) throw conflictoVersion();
    }),
  );
}

export function listarExhibidores(db: Ejecutor, o: { vendedorId?: string }): Promise<ExhibidorResumen[]> {
  return db
    .select()
    .from(vExhibidor)
    .where(o.vendedorId ? eq(vExhibidor.vendedorId, o.vendedorId) : undefined)
    .orderBy(asc(vExhibidor.estado), desc(vExhibidor.fechaEnvio));
}

/** Tres consultas fijas (resumen, piezas y apartadas), sin importar cuántas piezas tenga. */
export async function obtenerExhibidor(db: Ejecutor, id: string) {
  const [e] = await db.select().from(vExhibidor).where(eq(vExhibidor.id, id)).limit(1);
  if (!e) return null;
  const [piezas, apartadas] = await Promise.all([
    db
      .select({
        id: vPieza.id,
        codigo: vPieza.codigo,
        descripcion: vPieza.descripcion,
        precio: vPieza.precio,
      })
      .from(vPieza)
      .where(and(eq(vPieza.exhibidorId, id), eq(vPieza.estado, 'en_exhibidor')))
      .orderBy(asc(vPieza.codigo)),
    apartadasDeExhibidor(db, id),
  ]);
  return { ...e, piezas, apartadas };
}
export type PiezaEnExhibidor = NonNullable<Awaited<ReturnType<typeof obtenerExhibidor>>>['piezas'][number];
