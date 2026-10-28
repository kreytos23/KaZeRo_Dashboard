import type { Ejecutor } from '@/db/pool';
import { sql } from 'drizzle-orm';
import { codigoRecuperacion } from '@/db/schema';
import { cifrar } from './cifrado';
import { hashPassword, validarFortaleza } from './password';
import { hashCodigoRecuperacion, nuevosCodigosRecuperacion } from './tokens';
import { nuevoSecretoTotp, uriTotp } from './totp';

/** Acepta la conexión o una transacción. Quien llame con kazero_app debe haber re-autenticado al admin que da el alta. */
export async function crearAdmin(
  db: Ejecutor,
  datos: { email: string; password: string; nombre?: string | null },
  llaveTotp: string,
) {
  const error = validarFortaleza(datos.password);
  if (error) throw new Error(error);
  const email = datos.email.trim().toLowerCase();
  const secretoTotp = nuevoSecretoTotp();
  const codigosRecuperacion = nuevosCodigosRecuperacion();

  const passwordHash = await hashPassword(datos.password);
  // Atómico: un admin sin códigos de recuperación dejaría a producción abortando para siempre.
  const id = await db.transaction(async (tx) => {
    // INSERT crudo con solo las columnas concedidas a kazero_app: Drizzle listaría también `rol` (DEFAULT)
    // y la app no tiene privilegio para elegirlo.
    const r = await tx.execute<{ id: string }>(
      sql`INSERT INTO admin (email, nombre, password_hash, totp_secret_cifrado)
          VALUES (${email}, ${datos.nombre ?? null}, ${passwordHash}, ${cifrar(secretoTotp, llaveTotp)}) RETURNING id`,
    );
    const nuevoId = r.rows[0]!.id;
    await tx
      .insert(codigoRecuperacion)
      .values(codigosRecuperacion.map((c) => ({ adminId: nuevoId, hash: hashCodigoRecuperacion(c) })));
    return nuevoId;
  });
  return { id, secretoTotp, uriTotp: uriTotp(secretoTotp, email), codigosRecuperacion };
}
