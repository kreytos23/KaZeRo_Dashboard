import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db, Ejecutor } from '@/db/pool';
import { admin, codigoRecuperacion, sesion } from '@/db/schema';
import { conErroresDeNegocio, ErrorNegocio } from '@/server/errores';
import { crearAdmin } from './admin';
import { cifrar } from './cifrado';
import { reautenticarAdmin, registrarAcceso } from './servicio';
import { hashCodigoRecuperacion, nuevosCodigosRecuperacion } from './tokens';
import { nuevoSecretoTotp, uriTotp } from './totp';
import { validarAltaAdmin } from './validacion';

type Red = { ip: string | null; userAgent: string | null };
/** Los secretos, la URI y los códigos se devuelven una sola vez: no se registran ni se guardan en claro. */
export type ResultadoEnrolamiento =
  | { ok: true; email: string; secretoTotp: string; uriTotp: string; codigosRecuperacion: string[] }
  | { ok: false; error: string };

function mensajeReauth(r: { motivo: 'credenciales' | 'bloqueado'; minutosRestantes?: number }) {
  return r.motivo === 'bloqueado'
    ? `Demasiados intentos. Intenta de nuevo en ${r.minutosRestantes} min.`
    : 'Tu contraseña actual no es correcta.';
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

export function listarAdmins(db: Ejecutor) {
  return db
    .select({ id: admin.id, email: admin.email, createdAt: admin.createdAt })
    .from(admin)
    .orderBy(asc(admin.createdAt));
}

export async function agregarAdmin(
  db: Db,
  e: {
    adminActualId: string;
    passwordActual: string;
    email: string;
    password: string;
    confirmacion: string;
  } & Red,
  llaveTotp: string,
  ahora = new Date(),
): Promise<ResultadoEnrolamiento> {
  const email = e.email.trim().toLowerCase();
  const invalido = validarAltaAdmin({ email, password: e.password, confirmacion: e.confirmacion });
  if (invalido) return { ok: false, error: invalido };
  return comoResultado(() =>
    db.transaction(async (tx): Promise<ResultadoEnrolamiento> => {
      const r = await reautenticarAdmin(tx, e.adminActualId, e.passwordActual, e, ahora);
      if (!r.ok) return { ok: false, error: mensajeReauth(r) };
      const [existe] = await tx
        .select({ id: admin.id })
        .from(admin)
        .where(sql`lower(${admin.email}) = ${email}`)
        .limit(1);
      if (existe) return { ok: false, error: 'Ya existe un administrador con ese correo.' };
      const nuevo = await crearAdmin(tx, { email, password: e.password }, llaveTotp);
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
      if (!r.ok) return { ok: false, error: mensajeReauth(r) };
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
