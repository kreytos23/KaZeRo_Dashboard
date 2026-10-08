import type { Db } from '@/db/pool';
import { admin, codigoRecuperacion } from '@/db/schema';
import { cifrar } from './cifrado';
import { hashPassword, validarFortaleza } from './password';
import { hashCodigoRecuperacion, nuevosCodigosRecuperacion } from './tokens';
import { nuevoSecretoTotp, uriTotp } from './totp';

/** Requiere el rol dueño: kazero_app no puede insertar admins (mínimo privilegio). */
export async function crearAdmin(db: Db, datos: { email: string; password: string }, llaveTotp: string) {
  const error = validarFortaleza(datos.password);
  if (error) throw new Error(error);
  const email = datos.email.trim().toLowerCase();
  const secretoTotp = nuevoSecretoTotp();
  const codigosRecuperacion = nuevosCodigosRecuperacion();

  const [fila] = await db
    .insert(admin)
    .values({
      email,
      passwordHash: await hashPassword(datos.password),
      totpSecretCifrado: cifrar(secretoTotp, llaveTotp),
    })
    .returning({ id: admin.id });
  const id = fila!.id;
  await db
    .insert(codigoRecuperacion)
    .values(codigosRecuperacion.map((c) => ({ adminId: id, hash: hashCodigoRecuperacion(c) })));
  return { id, secretoTotp, uriTotp: uriTotp(secretoTotp, email), codigosRecuperacion };
}
