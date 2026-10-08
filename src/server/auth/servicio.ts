import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/pool';
import { accesoLog, admin, codigoRecuperacion, sesion } from '@/db/schema';
import { descifrar } from './cifrado';
import { hashPassword, verificarPassword } from './password';
import { hashCodigoRecuperacion, hashToken, nuevoToken } from './tokens';
import { pasoTotpValido } from './totp';

export const POLITICA = {
  maxFallos: 5,
  ventanaMin: 15,
  preMfaMin: 5,
  sesionDias: 30,
  refrescoMin: 60,
} as const;

type Red = { ip: string | null; userAgent: string | null };
type Evento = (typeof accesoLog.$inferInsert)['evento'];

const MIN = 60_000;
const masMinutos = (t: Date, m: number) => new Date(t.getTime() + m * MIN);

// Se verifica contra un hash real aunque el correo no exista: así el tiempo de respuesta no revela qué correos existen.
let hashSenuelo: Promise<string> | undefined;
const senuelo = () => (hashSenuelo ??= hashPassword('señuelo-que-nunca-es-una-contraseña-valida'));

function registrar(db: Db, email: string, evento: Evento, red: Red, ahora: Date) {
  return db
    .insert(accesoLog)
    .values({ email, evento, ip: red.ip, userAgent: red.userAgent, createdAt: ahora });
}

/** Minutos de bloqueo restantes (0 = libre). Cuenta fallos desde el último login_ok dentro de la ventana. */
async function minutosBloqueo(db: Db, email: string, ahora: Date): Promise<number> {
  const filas = await db
    .select({ evento: accesoLog.evento, createdAt: accesoLog.createdAt })
    .from(accesoLog)
    .where(and(eq(accesoLog.email, email), gt(accesoLog.createdAt, masMinutos(ahora, -POLITICA.ventanaMin))))
    .orderBy(desc(accesoLog.createdAt));
  const fallos: Date[] = [];
  for (const f of filas) {
    if (f.evento === 'login_ok') break;
    if (f.evento === 'password_fallido' || f.evento === 'totp_fallido') fallos.push(f.createdAt);
  }
  if (fallos.length < POLITICA.maxFallos) return 0;
  const libreEn = masMinutos(fallos[POLITICA.maxFallos - 1]!, POLITICA.ventanaMin).getTime();
  return Math.max(1, Math.ceil((libreEn - ahora.getTime()) / MIN));
}

export async function iniciarLogin(
  db: Db,
  e: { email: string; password: string } & Red,
  ahora = new Date(),
): Promise<
  | { ok: true; preToken: string }
  | { ok: false; motivo: 'credenciales' | 'bloqueado'; minutosRestantes?: number }
> {
  const email = e.email.trim().toLowerCase();
  const bloqueo = await minutosBloqueo(db, email, ahora);
  if (bloqueo > 0) {
    await registrar(db, email, 'bloqueado', e, ahora);
    return { ok: false, motivo: 'bloqueado', minutosRestantes: bloqueo };
  }
  const [fila] = await db
    .select()
    .from(admin)
    .where(sql`lower(${admin.email}) = ${email}`)
    .limit(1);
  const valido = await verificarPassword(fila?.passwordHash ?? (await senuelo()), e.password);
  if (!fila || !valido) {
    await registrar(db, email, 'password_fallido', e, ahora);
    return { ok: false, motivo: 'credenciales' };
  }
  const { token, hash } = nuevoToken();
  await db.insert(sesion).values({
    tokenHash: hash,
    adminId: fila.id,
    nivel: 'pre_mfa',
    expiraAt: masMinutos(ahora, POLITICA.preMfaMin),
    ultimoUsoAt: ahora,
    ip: e.ip,
    userAgent: e.userAgent,
    createdAt: ahora,
  });
  return { ok: true, preToken: token };
}

export async function verificarSegundoFactor(
  db: Db,
  e: { preToken: string; codigo: string } & Red,
  llaveTotp: string,
  ahora = new Date(),
): Promise<
  | { ok: true; token: string }
  | { ok: false; motivo: 'codigo' | 'bloqueado' | 'sesion'; minutosRestantes?: number }
> {
  const [pre] = await db
    .select({
      sesionId: sesion.id,
      adminId: admin.id,
      email: admin.email,
      secreto: admin.totpSecretCifrado,
      ultimoPaso: admin.totpUltimoPaso,
    })
    .from(sesion)
    .innerJoin(admin, eq(sesion.adminId, admin.id))
    .where(
      and(
        eq(sesion.tokenHash, hashToken(e.preToken)),
        eq(sesion.nivel, 'pre_mfa'),
        isNull(sesion.revocadaAt),
        gt(sesion.expiraAt, ahora),
      ),
    )
    .limit(1);
  if (!pre) return { ok: false, motivo: 'sesion' };

  const email = pre.email.toLowerCase();
  const bloqueo = await minutosBloqueo(db, email, ahora);
  if (bloqueo > 0) {
    await db.update(sesion).set({ revocadaAt: ahora }).where(eq(sesion.id, pre.sesionId));
    await registrar(db, email, 'bloqueado', e, ahora);
    return { ok: false, motivo: 'bloqueado', minutosRestantes: bloqueo };
  }

  const codigo = e.codigo.replace(/\s/g, '');
  let valido = false;
  let usoRecuperacion = false;
  if (/^\d{6}$/.test(codigo)) {
    const paso = pasoTotpValido(descifrar(pre.secreto, llaveTotp), codigo, ahora);
    if (paso !== null) {
      // UPDATE condicional y atómico: si otro login ya usó este paso (o uno posterior), no actualiza nada.
      const r = await db
        .update(admin)
        .set({ totpUltimoPaso: paso })
        .where(and(eq(admin.id, pre.adminId), lt(admin.totpUltimoPaso, paso)))
        .returning({ id: admin.id });
      valido = r.length === 1;
    }
  } else {
    const r = await db
      .update(codigoRecuperacion)
      .set({ usadoAt: ahora })
      .where(
        and(
          eq(codigoRecuperacion.adminId, pre.adminId),
          eq(codigoRecuperacion.hash, hashCodigoRecuperacion(codigo)),
          isNull(codigoRecuperacion.usadoAt),
        ),
      )
      .returning({ id: codigoRecuperacion.id });
    valido = usoRecuperacion = r.length === 1;
  }

  if (!valido) {
    await registrar(db, email, 'totp_fallido', e, ahora);
    return { ok: false, motivo: 'codigo' };
  }

  // Rotación: el pre-token muere y nace un token nuevo de sesión completa.
  await db.update(sesion).set({ revocadaAt: ahora }).where(eq(sesion.id, pre.sesionId));
  const { token, hash } = nuevoToken();
  await db.insert(sesion).values({
    tokenHash: hash,
    adminId: pre.adminId,
    nivel: 'completa',
    expiraAt: masMinutos(ahora, POLITICA.sesionDias * 24 * 60),
    ultimoUsoAt: ahora,
    ip: e.ip,
    userAgent: e.userAgent,
    createdAt: ahora,
  });
  await registrar(db, email, 'login_ok', e, ahora);
  if (usoRecuperacion) await registrar(db, email, 'codigo_recuperacion_usado', e, ahora);
  return { ok: true, token };
}

export async function validarSesion(db: Db, token: string, ahora = new Date()) {
  const [f] = await db
    .select({ sesionId: sesion.id, adminId: sesion.adminId, ultimoUsoAt: sesion.ultimoUsoAt })
    .from(sesion)
    .where(
      and(
        eq(sesion.tokenHash, hashToken(token)),
        eq(sesion.nivel, 'completa'),
        isNull(sesion.revocadaAt),
        gt(sesion.expiraAt, ahora),
      ),
    )
    .limit(1);
  if (!f) return null;
  if (ahora.getTime() - f.ultimoUsoAt.getTime() > POLITICA.refrescoMin * MIN) {
    await db.update(sesion).set({ ultimoUsoAt: ahora }).where(eq(sesion.id, f.sesionId));
  }
  return { adminId: f.adminId, sesionId: f.sesionId };
}

export async function cerrarSesion(db: Db, token: string, ahora = new Date()) {
  await db
    .update(sesion)
    .set({ revocadaAt: ahora })
    .where(and(eq(sesion.tokenHash, hashToken(token)), isNull(sesion.revocadaAt)));
}

export async function cerrarTodas(db: Db, adminId: string, ahora = new Date()) {
  await db
    .update(sesion)
    .set({ revocadaAt: ahora })
    .where(and(eq(sesion.adminId, adminId), isNull(sesion.revocadaAt)));
}
