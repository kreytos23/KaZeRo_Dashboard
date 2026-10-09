import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { validarAltaAdmin } from '../../src/server/auth/validacion';

/**
 * Pide correo y contraseña (dos veces) y los valida ANTES de que el script cambie nada.
 * Si algo no es válido, sale con código 1 sin haber tocado la BD ni los secretos.
 */
export async function pedirDatosAdmin(pregunta: string): Promise<{ email: string; password: string }> {
  const rl = createInterface({ input: stdin, output: stdout });
  let datos: { email: string; password: string; confirmacion: string };
  try {
    const email = (await rl.question(pregunta)).trim();
    const password = await rl.question(
      'Contraseña (mín. 12; se verá al teclear, limpia la terminal después): ',
    );
    const confirmacion = await rl.question('Repite la contraseña: ');
    datos = { email, password, confirmacion };
  } finally {
    rl.close();
  }
  const error = validarAltaAdmin(datos);
  if (error) {
    console.error(`${error} No se cambió nada.`);
    process.exit(1);
  }
  return { email: datos.email, password: datos.password };
}
