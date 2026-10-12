import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { pieza, vPieza } from '@/db/schema';
import { rutaImagen } from '@/domain/imagenes';
import { fijarContextoAuditoria } from '@/server/auditoria/servicio';
import { ErrorNegocio, conErroresDeNegocio, conflictoVersion } from '@/server/errores';
import type { AlmacenImagenes } from '@/server/imagenes/almacen';
import type { ImagenProcesada } from '@/server/imagenes/procesar';
import { altaPieza, type DatosPieza } from './servicio';

const rutasDe = (piezaId: string, clave: string) =>
  [rutaImagen(piezaId, clave, 'grande'), rutaImagen(piezaId, clave, 'mini')] as const;

/** Dos `guardar` fijos en paralelo (sin N+1). Si uno falla, se intenta borrar el otro. */
async function subir(almacen: AlmacenImagenes, piezaId: string, clave: string, img: ImagenProcesada) {
  const [g, m] = rutasDe(piezaId, clave);
  const r = await Promise.allSettled([almacen.guardar(g, img.grande), almacen.guardar(m, img.mini)]);
  const fallo = r.find((x): x is PromiseRejectedResult => x.status === 'rejected');
  if (fallo) {
    // Solo el nombre del error: el mensaje de Blob puede traer rutas o tokens.
    console.error(
      '[imagen] no se pudo guardar',
      fallo.reason instanceof Error ? fallo.reason.name : typeof fallo.reason,
    );
    await borrarSinFallar(almacen, [g, m]);
    throw new ErrorNegocio('imagen_almacen', 'No se pudo guardar la foto. Intenta de nuevo.', 'imagen');
  }
}

/** Best effort: un blob huérfano es inofensivo (privado, no se sirve; lo recoge el barrido); una BD rota no. */
async function borrarSinFallar(almacen: AlmacenImagenes, rutas: readonly string[]) {
  try {
    await almacen.borrar(rutas);
  } catch (e) {
    console.error(
      '[imagen] no se pudieron borrar',
      rutas.length,
      'blobs',
      e instanceof Error ? e.name : typeof e,
    );
  }
}

/**
 * Tras un fallo, borra los blobs nuevos SOLO si la BD no los referencia (el COMMIT pudo aplicarse aunque la
 * respuesta se perdiera). Si ni siquiera se puede leer, no borra: mejor un huérfano que apuntar a la nada.
 */
async function limpiarSiHuerfana(db: Ejecutor, almacen: AlmacenImagenes, piezaId: string, clave: string) {
  try {
    const [f] = await db.select({ clave: pieza.imagenClave }).from(pieza).where(eq(pieza.id, piezaId));
    if (f?.clave !== clave) await borrarSinFallar(almacen, rutasDe(piezaId, clave));
  } catch {
    /* sin lectura no se borra */
  }
}

/** Verificación previa (flujo de escritura, sin bloqueo): no subir en balde si la versión ya es vieja. */
async function verificarVersion(db: Ejecutor, piezaId: string, version: number) {
  const [f] = await db.select({ version: pieza.version }).from(pieza).where(eq(pieza.id, piezaId));
  if (!f) throw new ErrorNegocio('no_encontrada', 'La pieza no existe.');
  if (f.version !== version) throw conflictoVersion();
}

/** Apunta la pieza a `clave` en una transacción con bloqueo optimista; la bitácora la escribe kz_auditar (D6, D8). */
async function apuntarA(
  db: Ejecutor,
  d: { piezaId: string; version: number; adminId: string },
  clave: string | null,
): Promise<{ codigo: string; anterior: string | null }> {
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const [actual] = await tx
        .select({ codigo: pieza.codigo, version: pieza.version, clave: pieza.imagenClave })
        .from(pieza)
        .where(eq(pieza.id, d.piezaId))
        .for('update');
      if (!actual) throw new ErrorNegocio('no_encontrada', 'La pieza no existe.');
      if (actual.version !== d.version) throw conflictoVersion();
      // Sin cambios (quitar cuando no hay foto): ni UPDATE, ni versión nueva, ni bitácora.
      if (actual.clave === clave) return { codigo: actual.codigo, anterior: null };
      await fijarContextoAuditoria(tx, { adminId: d.adminId, motivo: null });
      const r = await tx
        .update(pieza)
        .set({ imagenClave: clave, version: sql`${pieza.version} + 1` })
        .where(and(eq(pieza.id, d.piezaId), eq(pieza.version, d.version)))
        .returning({ id: pieza.id });
      if (r.length !== 1) throw conflictoVersion();
      return { codigo: actual.codigo, anterior: actual.clave };
    }),
  );
}

/** Sube o cambia la foto. Se permite en cualquier estado (también vendida): no es dinero ni estado. */
export async function cambiarImagenPieza(
  db: Ejecutor,
  almacen: AlmacenImagenes,
  d: { piezaId: string; version: number; adminId: string; imagen: ImagenProcesada },
): Promise<{ codigo: string }> {
  await verificarVersion(db, d.piezaId, d.version);
  const clave = randomUUID();
  await subir(almacen, d.piezaId, clave, d.imagen);
  let r: { codigo: string; anterior: string | null };
  try {
    r = await apuntarA(db, d, clave);
  } catch (e) {
    await limpiarSiHuerfana(db, almacen, d.piezaId, clave);
    throw e;
  }
  if (r.anterior) await borrarSinFallar(almacen, rutasDe(d.piezaId, r.anterior));
  return { codigo: r.codigo };
}

export async function quitarImagenPieza(
  db: Ejecutor,
  almacen: AlmacenImagenes,
  d: { piezaId: string; version: number; adminId: string },
): Promise<{ cambios: 0 | 1; codigo: string }> {
  const r = await apuntarA(db, d, null);
  if (!r.anterior) return { cambios: 0, codigo: r.codigo };
  await borrarSinFallar(almacen, rutasDe(d.piezaId, r.anterior));
  return { cambios: 1, codigo: r.codigo };
}

/** Alta con foto opcional: blobs primero (con id y clave generados aquí), luego el INSERT. */
export async function altaPiezaConFoto(
  db: Ejecutor,
  almacen: AlmacenImagenes,
  d: DatosPieza,
  imagen: ImagenProcesada | null,
): Promise<{ id: string; codigo: string }> {
  if (!imagen) return altaPieza(db, d);
  const id = randomUUID();
  const clave = randomUUID();
  await subir(almacen, id, clave, imagen);
  try {
    return await altaPieza(db, d, { id, imagenClave: clave });
  } catch (e) {
    await limpiarSiHuerfana(db, almacen, id, clave);
    throw e;
  }
}

/** Lectura (ruta de imagen): la clave vigente sale de la vista, nunca del cliente. */
export async function claveImagenDePieza(db: Ejecutor, piezaId: string): Promise<string | null> {
  const [f] = await db
    .select({ clave: vPieza.imagenClave })
    .from(vPieza)
    .where(eq(vPieza.id, piezaId))
    .limit(1);
  return f?.clave ?? null;
}
