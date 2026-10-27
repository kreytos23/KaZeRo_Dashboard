import { and, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Db, Ejecutor } from '@/db/pool';
import { accesoLog, admin, codigoRecuperacion, sesion } from '@/db/schema';
import { descifrar } from './cifrado';
import { hashPassword, verificarPassword } from './password';
import { hashCodigoRecuperacion, hashToken, nuevoToken } from './tokens';
import { pasoTotpValido } from './totp';

/**
 * Dos límites. Por correo: 5 fallos en 15 min bloquean ese correo; quien lo conozca puede mantener bloqueado
 * al admin (riesgo aceptado: en un panel de un solo admin es preferible). Por IP: 30 fallos en 15 min
 * bloquean esa IP, que sale de x-forwarded-for (confiable en Vercel, que lo fija el borde). Recuperación:
 * esperar 15 min o borrar los fallos en la BD.
 */
export const POLITICA = {
  maxFallos: 5,
  ventanaMin: 15,
  preMfaMin: 5,
  sesionDias: 30,
  refrescoMin: 60,
} as const;

export const MAX_FALLOS_IP = 30;
export const VENTANA_IP_MIN = 15;

type Red = { ip: string | null; userAgent: string | null };
type Evento = (typeof accesoLog.$inferInsert)['evento'];

const MIN = 60_000;
const masMinutos = (t: Date, m: number) => new Date(t.getTime() + m * MIN);

// Se verifica contra un hash real aunque el correo no exista: así el tiempo de respuesta no revela qué correos existen.
let hashSenuelo: Promise<string> | undefined;
const senuelo = () => (hashSenuelo ??= hashPassword('señuelo-que-nunca-es-una-contraseña-valida'));

/** Se lanza dentro de una transacción para deshacerla y aun así devolver un resultado. */
class Revertir<T> extends Error {
  constructor(readonly resultado: T) {
    super('transacción revertida');
  }
}

/**
 * Serializa los intentos de login de un mismo correo hasta el fin de la transacción.
 * Sin esto, N intentos en paralelo verían todos menos de maxFallos fallos y se verificarían todos.
 */
async function bloquearCorreo(tx: Ejecutor, email: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'kazero:login:' + email}))`);
}

export function registrarAcceso(db: Ejecutor, email: string, evento: Evento, red: Red, ahora: Date) {
  return db
    .insert(accesoLog)
    .values({ email, evento, ip: red.ip, userAgent: red.userAgent, createdAt: ahora });
}

const LIMITE_CORREO = { max: POLITICA.maxFallos, ventanaMin: POLITICA.ventanaMin, cortaEnLoginOk: true };
const LIMITE_IP = { max: MAX_FALLOS_IP, ventanaMin: VENTANA_IP_MIN, cortaEnLoginOk: false };

/**
 * Minutos de bloqueo restantes (0 = libre) para las filas que cumplan `donde` (un correo o una IP): cuenta
 * password_fallido/totp_fallido dentro de la ventana. Por correo, además, el último login_ok corta el conteo.
 */
async function minutosBloqueo(
  db: Ejecutor,
  ahora: Date,
  donde: SQL,
  l: { max: number; ventanaMin: number; cortaEnLoginOk: boolean },
): Promise<number> {
  const eventos: Evento[] = l.cortaEnLoginOk
    ? ['login_ok', 'password_fallido', 'totp_fallido']
    : ['password_fallido', 'totp_fallido'];
  const filas = await db
    .select({ evento: accesoLog.evento, createdAt: accesoLog.createdAt })
    .from(accesoLog)
    .where(
      and(
        donde,
        gt(accesoLog.createdAt, masMinutos(ahora, -l.ventanaMin)),
        inArray(accesoLog.evento, eventos),
      ),
    )
    // Desempate determinista: en el mismo instante, los fallos van antes que el login_ok (false < true),
    // así un login_ok simultáneo no corta el conteo según el orden físico de las filas.
    .orderBy(desc(accesoLog.createdAt), sql`(${accesoLog.evento} = 'login_ok')`)
    .limit(l.max + 1);
  const fallos: Date[] = [];
  for (const f of filas) {
    if (f.evento === 'login_ok') break;
    fallos.push(f.createdAt);
  }
  if (fallos.length < l.max) return 0;
  // Con ≥ max fallos, el bloqueo termina cuando el max-ésimo más reciente sale de la ventana.
  const libreEn = masMinutos(fallos[l.max - 1]!, l.ventanaMin).getTime();
  return Math.max(1, Math.ceil((libreEn - ahora.getTime()) / MIN));
}

const minutosBloqueoCorreo = (db: Ejecutor, email: string, ahora: Date) =>
  minutosBloqueo(db, ahora, eq(accesoLog.email, email), LIMITE_CORREO);

/** IP nula → 0: no se puede limitar (el intento se registra igual). */
const minutosBloqueoIp = (db: Ejecutor, ip: string | null, ahora: Date) =>
  ip ? minutosBloqueo(db, ahora, eq(accesoLog.ip, ip), LIMITE_IP) : Promise.resolve(0);

/** Bloqueo combinado: el mayor entre el de correo y el de IP, para que el mensaje sea idéntico. */
async function bloqueoTotal(tx: Ejecutor, email: string, ip: string | null, ahora: Date) {
  return Math.max(await minutosBloqueoCorreo(tx, email, ahora), await minutosBloqueoIp(tx, ip, ahora));
}

type ResultadoLogin =
  | { ok: true; preToken: string }
  | { ok: false; motivo: 'credenciales' | 'bloqueado'; minutosRestantes?: number };

export async function iniciarLogin(
  db: Db,
  e: { email: string; password: string } & Red,
  ahora = new Date(),
): Promise<ResultadoLogin> {
  const email = e.email.trim().toLowerCase();
  // Una sola transacción por intento: contar fallos, verificar y registrar el resultado sin carreras.
  // Los fallos se devuelven (no se lanzan) para que su registro sí se confirme.
  return db.transaction(async (tx): Promise<ResultadoLogin> => {
    // El candado serializa por correo; intentos simultáneos desde una misma IP con correos distintos pueden
    // pasar de MAX_FALLOS_IP por una carrera mínima (aceptado).
    await bloquearCorreo(tx, email);
    const bloqueo = await bloqueoTotal(tx, email, e.ip, ahora);
    if (bloqueo > 0) {
      await registrarAcceso(tx, email, 'bloqueado', e, ahora);
      return { ok: false, motivo: 'bloqueado', minutosRestantes: bloqueo };
    }
    const [fila] = await tx
      .select({ id: admin.id, passwordHash: admin.passwordHash })
      .from(admin)
      .where(sql`lower(${admin.email}) = ${email}`)
      .limit(1);
    const valido = await verificarPassword(fila?.passwordHash ?? (await senuelo()), e.password);
    if (!fila || !valido) {
      await registrarAcceso(tx, email, 'password_fallido', e, ahora);
      return { ok: false, motivo: 'credenciales' };
    }
    const { token, hash } = nuevoToken();
    await tx.insert(sesion).values({
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
  });
}

type ResultadoSegundoFactor =
  | { ok: true; token: string }
  | { ok: false; motivo: 'codigo' | 'bloqueado' | 'sesion'; minutosRestantes?: number };

export async function verificarSegundoFactor(
  db: Db,
  e: { preToken: string; codigo: string } & Red,
  llaveTotp: string,
  ahora = new Date(),
): Promise<ResultadoSegundoFactor> {
  const preVigente = and(
    eq(sesion.tokenHash, hashToken(e.preToken)),
    eq(sesion.nivel, 'pre_mfa'),
    isNull(sesion.revocadaAt),
    gt(sesion.expiraAt, ahora),
  );
  // Primera lectura sin candado, solo para saber qué correo serializar.
  const [inicial] = await db
    .select({ email: admin.email })
    .from(sesion)
    .innerJoin(admin, eq(sesion.adminId, admin.id))
    .where(preVigente)
    .limit(1);
  if (!inicial) return { ok: false, motivo: 'sesion' };
  const email = inicial.email.toLowerCase();

  // Todo el segundo paso es una transacción: si algo falla a medias, no se quema el paso TOTP
  // ni el código de recuperación sin crear la sesión.
  try {
    return await db.transaction(async (tx): Promise<ResultadoSegundoFactor> => {
      await bloquearCorreo(tx, email);
      // Releer con el candado tomado: otro intento pudo haber consumido o revocado el pre-token.
      const [pre] = await tx
        .select({ sesionId: sesion.id, adminId: sesion.adminId })
        .from(sesion)
        .where(preVigente)
        .limit(1)
        .for('update');
      if (!pre) return { ok: false, motivo: 'sesion' };

      const bloqueo = await bloqueoTotal(tx, email, e.ip, ahora);
      if (bloqueo > 0) {
        await tx.update(sesion).set({ revocadaAt: ahora }).where(eq(sesion.id, pre.sesionId));
        await registrarAcceso(tx, email, 'bloqueado', e, ahora);
        return { ok: false, motivo: 'bloqueado', minutosRestantes: bloqueo };
      }

      const codigo = e.codigo.replace(/\s/g, '');
      let valido = false;
      let usoRecuperacion = false;
      if (/^\d{6}$/.test(codigo)) {
        const [a] = await tx
          .select({ secreto: admin.totpSecretCifrado })
          .from(admin)
          .where(eq(admin.id, pre.adminId))
          .limit(1);
        const paso = a ? pasoTotpValido(descifrar(a.secreto, llaveTotp), codigo, ahora) : null;
        if (paso !== null) {
          // UPDATE condicional y atómico: si otro login ya usó este paso (o uno posterior), no actualiza nada.
          const r = await tx
            .update(admin)
            .set({ totpUltimoPaso: paso })
            .where(and(eq(admin.id, pre.adminId), lt(admin.totpUltimoPaso, paso)))
            .returning({ id: admin.id });
          valido = r.length === 1;
        }
      } else {
        const r = await tx
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
        await registrarAcceso(tx, email, 'totp_fallido', e, ahora);
        return { ok: false, motivo: 'codigo' };
      }

      // Rotación: el pre-token muere (consumo condicional, un solo ganador) y nace un token de sesión completa.
      const consumido = await tx
        .update(sesion)
        .set({ revocadaAt: ahora })
        .where(and(eq(sesion.id, pre.sesionId), isNull(sesion.revocadaAt)))
        .returning({ id: sesion.id });
      // Si otro intento ya consumió el pre-token, se deshace lo hecho (paso TOTP o código de recuperación).
      if (consumido.length !== 1) {
        throw new Revertir<ResultadoSegundoFactor>({ ok: false, motivo: 'sesion' });
      }

      const { token, hash } = nuevoToken();
      await tx.insert(sesion).values({
        tokenHash: hash,
        adminId: pre.adminId,
        nivel: 'completa',
        expiraAt: masMinutos(ahora, POLITICA.sesionDias * 24 * 60),
        ultimoUsoAt: ahora,
        ip: e.ip,
        userAgent: e.userAgent,
        createdAt: ahora,
      });
      await registrarAcceso(tx, email, 'login_ok', e, ahora);
      if (usoRecuperacion) await registrarAcceso(tx, email, 'codigo_recuperacion_usado', e, ahora);
      return { ok: true, token };
    });
  } catch (err) {
    if (err instanceof Revertir) return err.resultado as ResultadoSegundoFactor;
    throw err;
  }
}

/**
 * Re-autenticación para operaciones sensibles (alta de admin, regenerar TOTP). Aplica el mismo bloqueo
 * por correo que el login. Llamar SIEMPRE dentro de una transacción (usa pg_advisory_xact_lock) y devolver,
 * no lanzar, en caso de fallo: así el registro del fallo se confirma.
 */
export async function reautenticarAdmin(
  tx: Ejecutor,
  adminId: string,
  password: string,
  red: Red,
  ahora = new Date(),
): Promise<
  { ok: true; email: string } | { ok: false; motivo: 'credenciales' | 'bloqueado'; minutosRestantes?: number }
> {
  const [fila] = await tx
    .select({ email: admin.email, passwordHash: admin.passwordHash })
    .from(admin)
    .where(eq(admin.id, adminId))
    .limit(1);
  if (!fila) return { ok: false, motivo: 'credenciales' };
  const email = fila.email.toLowerCase();
  await bloquearCorreo(tx, email);
  const bloqueo = await minutosBloqueoCorreo(tx, email, ahora);
  if (bloqueo > 0) {
    await registrarAcceso(tx, email, 'bloqueado', red, ahora);
    return { ok: false, motivo: 'bloqueado', minutosRestantes: bloqueo };
  }
  if (!(await verificarPassword(fila.passwordHash, password))) {
    await registrarAcceso(tx, email, 'password_fallido', red, ahora);
    return { ok: false, motivo: 'credenciales' };
  }
  return { ok: true, email };
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

const SIN_RED: Red = { ip: null, userAgent: null };

async function emailDe(db: Ejecutor, adminId: string) {
  const [a] = await db.select({ email: admin.email }).from(admin).where(eq(admin.id, adminId)).limit(1);
  return a?.email.toLowerCase() ?? null;
}

export async function cerrarSesion(db: Db, token: string, ahora = new Date(), red: Red = SIN_RED) {
  // Revocar y registrar van juntos: no queda una sesión cerrada sin su evento.
  await db.transaction(async (tx) => {
    const [s] = await tx
      .update(sesion)
      .set({ revocadaAt: ahora })
      .where(and(eq(sesion.tokenHash, hashToken(token)), isNull(sesion.revocadaAt)))
      .returning({ adminId: sesion.adminId });
    const email = s ? await emailDe(tx, s.adminId) : null;
    if (email) await registrarAcceso(tx, email, 'logout', red, ahora);
  });
}

export async function cerrarTodas(db: Db, adminId: string, ahora = new Date(), red: Red = SIN_RED) {
  await db.transaction(async (tx) => {
    await tx
      .update(sesion)
      .set({ revocadaAt: ahora })
      .where(and(eq(sesion.adminId, adminId), isNull(sesion.revocadaAt)));
    const email = await emailDe(tx, adminId);
    if (email) await registrarAcceso(tx, email, 'logout_todos', red, ahora);
  });
}
