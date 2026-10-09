import { and, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/pool';
import { accesoLog, admin, codigoRecuperacion, sesion } from '@/db/schema';
import { descifrar } from './cifrado';
import { hashPassword, verificarPassword } from './password';
import { hashCodigoRecuperacion, hashToken, nuevoToken } from './tokens';
import { pasoTotpValido } from './totp';

/**
 * Riesgo aceptado: el bloqueo es por correo, así que quien conozca el correo del admin puede mantenerlo
 * bloqueado (5 intentos malos cada 15 min). Para un panel de un solo admin es preferible a un bloqueo
 * por IP, que se evade rotando IPs. Recuperación: esperar 15 min o borrar los fallos en la BD.
 */
export const POLITICA = {
  maxFallos: 5,
  ventanaMin: 15,
  preMfaMin: 5,
  sesionDias: 30,
  refrescoMin: 60,
} as const;

type Red = { ip: string | null; userAgent: string | null };
type Evento = (typeof accesoLog.$inferInsert)['evento'];
/** La conexión directa o una transacción en curso. */
type Ejecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

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

function registrar(db: Ejecutor, email: string, evento: Evento, red: Red, ahora: Date) {
  return db
    .insert(accesoLog)
    .values({ email, evento, ip: red.ip, userAgent: red.userAgent, createdAt: ahora });
}

/** Minutos de bloqueo restantes (0 = libre). Cuenta fallos desde el último login_ok dentro de la ventana. */
async function minutosBloqueo(db: Ejecutor, email: string, ahora: Date): Promise<number> {
  const filas = await db
    .select({ evento: accesoLog.evento, createdAt: accesoLog.createdAt })
    .from(accesoLog)
    .where(
      and(
        eq(accesoLog.email, email),
        gt(accesoLog.createdAt, masMinutos(ahora, -POLITICA.ventanaMin)),
        inArray(accesoLog.evento, ['login_ok', 'password_fallido', 'totp_fallido']),
      ),
    )
    .orderBy(desc(accesoLog.createdAt))
    .limit(POLITICA.maxFallos + 1);
  const fallos: Date[] = [];
  for (const f of filas) {
    if (f.evento === 'login_ok') break;
    fallos.push(f.createdAt);
  }
  if (fallos.length < POLITICA.maxFallos) return 0;
  const libreEn = masMinutos(fallos[POLITICA.maxFallos - 1]!, POLITICA.ventanaMin).getTime();
  return Math.max(1, Math.ceil((libreEn - ahora.getTime()) / MIN));
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
    await bloquearCorreo(tx, email);
    const bloqueo = await minutosBloqueo(tx, email, ahora);
    if (bloqueo > 0) {
      await registrar(tx, email, 'bloqueado', e, ahora);
      return { ok: false, motivo: 'bloqueado', minutosRestantes: bloqueo };
    }
    const [fila] = await tx
      .select({ id: admin.id, passwordHash: admin.passwordHash })
      .from(admin)
      .where(sql`lower(${admin.email}) = ${email}`)
      .limit(1);
    const valido = await verificarPassword(fila?.passwordHash ?? (await senuelo()), e.password);
    if (!fila || !valido) {
      await registrar(tx, email, 'password_fallido', e, ahora);
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

      const bloqueo = await minutosBloqueo(tx, email, ahora);
      if (bloqueo > 0) {
        await tx.update(sesion).set({ revocadaAt: ahora }).where(eq(sesion.id, pre.sesionId));
        await registrar(tx, email, 'bloqueado', e, ahora);
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
        await registrar(tx, email, 'totp_fallido', e, ahora);
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
      await registrar(tx, email, 'login_ok', e, ahora);
      if (usoRecuperacion) await registrar(tx, email, 'codigo_recuperacion_usado', e, ahora);
      return { ok: true, token };
    });
  } catch (err) {
    if (err instanceof Revertir) return err.resultado as ResultadoSegundoFactor;
    throw err;
  }
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
