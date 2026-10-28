import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db, Ejecutor } from '@/db/pool';
import { admin, codigoRecuperacion, sesion, vAdmin } from '@/db/schema';
import { conErroresDeNegocio, ErrorNegocio } from '@/server/errores';
import { crearAdmin } from './admin';
import { EMAIL_ADMIN_MIGRACION } from './admin-migracion';
import { cifrar } from './cifrado';
import { reautenticarAdmin, registrarAcceso } from './servicio';
import { hashCodigoRecuperacion, nuevosCodigosRecuperacion } from './tokens';
import { nuevoSecretoTotp, uriTotp } from './totp';
import { validarAltaAdmin, validarNombre } from './validacion';

type Red = { ip: string | null; userAgent: string | null };
/** Los secretos, la URI y los códigos se devuelven una sola vez: no se registran ni se guardan en claro. */
export type ResultadoEnrolamiento =
  | { ok: true; email: string; secretoTotp: string; uriTotp: string; codigosRecuperacion: string[] }
  | { ok: false; error: string; /** Se superó el límite de intentos de contraseña. */ bloqueado?: true };

function mensajeReauth(r: { motivo: 'credenciales' | 'bloqueado'; minutosRestantes?: number }) {
  return r.motivo === 'bloqueado'
    ? `Demasiados intentos. Intenta de nuevo en ${r.minutosRestantes} min.`
    : 'Tu contraseña actual no es correcta.';
}

/**
 * Sesión robada: quien la tenga no puede seguir probando contraseñas; al bloquearse la re-autenticación
 * se revoca la sesión actual y la interfaz sale a /login?motivo=bloqueado.
 */
async function rechazoReauth(
  tx: Ejecutor,
  r: { motivo: 'credenciales' | 'bloqueado'; minutosRestantes?: number },
  s: { adminId: string; sesionActualId: string },
  ahora: Date,
): Promise<ResultadoEnrolamiento> {
  if (r.motivo !== 'bloqueado') return { ok: false, error: mensajeReauth(r) };
  await tx
    .update(sesion)
    .set({ revocadaAt: ahora })
    .where(and(eq(sesion.id, s.sesionActualId), eq(sesion.adminId, s.adminId), isNull(sesion.revocadaAt)));
  return { ok: false, error: mensajeReauth(r), bloqueado: true };
}

/** Un ErrorNegocio traducido (p. ej. correo repetido por carrera) se devuelve como fallo de formulario. */
async function comoResultado(fn: () => Promise<ResultadoEnrolamiento>): Promise<ResultadoEnrolamiento> {
  try {
    return await conErroresDeNegocio(fn);
  } catch (e) {
    if (e instanceof ErrorNegocio) return { ok: false, error: e.message };
    throw e;
  }
}

/** Sin el admin "migración": no es una persona ni puede entrar (Plan 7a). */
export function listarAdmins(db: Ejecutor) {
  return db
    .select({ id: vAdmin.id, email: vAdmin.email, nombre: vAdmin.nombre, createdAt: vAdmin.createdAt })
    .from(vAdmin)
    .where(ne(sql`lower(${vAdmin.email})`, EMAIL_ADMIN_MIGRACION))
    .orderBy(asc(vAdmin.createdAt));
}

/** Nombre con el que se saluda al administrador; null si no tiene. */
export async function nombreDeAdmin(db: Ejecutor, adminId: string) {
  const [a] = await db.select({ nombre: vAdmin.nombre }).from(vAdmin).where(eq(vAdmin.id, adminId)).limit(1);
  return a?.nombre ?? null;
}

/** Cambia (o quita, con vacío) el nombre de un administrador. No es sensible: no pide contraseña. */
export async function guardarNombreAdmin(db: Ejecutor, adminId: string, crudo: string) {
  const { nombre, error } = validarNombre(crudo);
  if (error) throw new ErrorNegocio('validacion', error, 'nombre');
  const r = await db
    .update(admin)
    .set({ nombre })
    .where(and(eq(admin.id, adminId), ne(sql`lower(${admin.email})`, EMAIL_ADMIN_MIGRACION)))
    .returning({ id: admin.id });
  if (r.length === 0) throw new ErrorNegocio('no_encontrado', 'Administrador no encontrado.');
}

export async function agregarAdmin(
  db: Db,
  e: {
    adminActualId: string;
    sesionActualId: string;
    passwordActual: string;
    email: string;
    nombre?: string;
    password: string;
    confirmacion: string;
  } & Red,
  llaveTotp: string,
  ahora = new Date(),
): Promise<ResultadoEnrolamiento> {
  const email = e.email.trim().toLowerCase();
  const invalido = validarAltaAdmin({ email, password: e.password, confirmacion: e.confirmacion });
  if (invalido) return { ok: false, error: invalido };
  const { nombre, error: errorNombre } = validarNombre(e.nombre ?? '');
  if (errorNombre) return { ok: false, error: errorNombre };
  return comoResultado(() =>
    db.transaction(async (tx): Promise<ResultadoEnrolamiento> => {
      const r = await reautenticarAdmin(tx, e.adminActualId, e.passwordActual, e, ahora);
      if (!r.ok)
        return rechazoReauth(tx, r, { adminId: e.adminActualId, sesionActualId: e.sesionActualId }, ahora);
      const [existe] = await tx
        .select({ id: admin.id })
        .from(admin)
        .where(sql`lower(${admin.email}) = ${email}`)
        .limit(1);
      if (existe) return { ok: false, error: 'Ya existe un administrador con ese correo.' };
      const nuevo = await crearAdmin(tx, { email, nombre, password: e.password }, llaveTotp);
      await registrarAcceso(tx, r.email, 'admin_creado', e, ahora);
      return {
        ok: true,
        email,
        secretoTotp: nuevo.secretoTotp,
        uriTotp: nuevo.uriTotp,
        codigosRecuperacion: nuevo.codigosRecuperacion,
      };
    }),
  );
}

export async function regenerarTotp(
  db: Db,
  e: { adminId: string; sesionActualId: string; passwordActual: string } & Red,
  llaveTotp: string,
  ahora = new Date(),
): Promise<ResultadoEnrolamiento> {
  return comoResultado(() =>
    db.transaction(async (tx): Promise<ResultadoEnrolamiento> => {
      const r = await reautenticarAdmin(tx, e.adminId, e.passwordActual, e, ahora);
      if (!r.ok) return rechazoReauth(tx, r, e, ahora);
      const secreto = nuevoSecretoTotp();
      const codigos = nuevosCodigosRecuperacion();
      await tx
        .update(admin)
        .set({
          totpSecretCifrado: cifrar(secreto, llaveTotp),
          totpUltimoPaso: 0,
          version: sql`${admin.version} + 1`,
        })
        .where(eq(admin.id, e.adminId));
      // kazero_app no puede borrar: los códigos viejos se marcan usados y dejan de servir.
      await tx
        .update(codigoRecuperacion)
        .set({ usadoAt: ahora })
        .where(and(eq(codigoRecuperacion.adminId, e.adminId), isNull(codigoRecuperacion.usadoAt)));
      await tx
        .insert(codigoRecuperacion)
        .values(codigos.map((c) => ({ adminId: e.adminId, hash: hashCodigoRecuperacion(c) })));
      // sesionActualId solo se usa en ne(): conservar esa sesión no exige comprobar que sea del admin
      // (si no coincide con ninguna, simplemente se revocan todas).
      // Quien tuviera el TOTP viejo pierde sus sesiones; la actual se conserva.
      await tx
        .update(sesion)
        .set({ revocadaAt: ahora })
        .where(
          and(eq(sesion.adminId, e.adminId), isNull(sesion.revocadaAt), ne(sesion.id, e.sesionActualId)),
        );
      await registrarAcceso(tx, r.email, 'totp_regenerado', e, ahora);
      return {
        ok: true,
        email: r.email,
        secretoTotp: secreto,
        uriTotp: uriTotp(secreto, r.email),
        codigosRecuperacion: codigos,
      };
    }),
  );
}
