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

  const passwordHash = await hashPassword(datos.password);
  // Atómico: un admin sin códigos de recuperación dejaría a producción abortando para siempre.
  const id = await db.transaction(async (tx) => {
    const [fila] = await tx
      .insert(admin)
      .values({ email, passwordHash, totpSecretCifrado: cifrar(secretoTotp, llaveTotp) })
      .returning({ id: admin.id });
    const nuevoId = fila!.id;
    await tx
      .insert(codigoRecuperacion)
      .values(codigosRecuperacion.map((c) => ({ adminId: nuevoId, hash: hashCodigoRecuperacion(c) })));
    return nuevoId;
  });
  return { id, secretoTotp, uriTotp: uriTotp(secretoTotp, email), codigosRecuperacion };
}
