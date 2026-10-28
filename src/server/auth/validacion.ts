// Sin 'server-only': lo usan también los scripts de configuración (tsx), no solo el servidor.
import { z } from 'zod';
import { validarFortaleza } from './password';

/** El mismo criterio de correo en el login y al dar de alta un admin. */
export const esquemaCorreo = z.email().max(200);

/** Nombre opcional del administrador: vacío es «sin nombre» (null); el CHECK de la BD exige 1..60. */
export function validarNombre(crudo: string): { nombre: string | null; error: string | null } {
  const nombre = crudo.trim().replace(/\s+/g, ' ') || null;
  return nombre && nombre.length > 60
    ? { nombre, error: 'El nombre no puede pasar de 60 caracteres.' }
    : { nombre, error: null };
}

/** Valida el alta de un admin. Devuelve el mensaje de error (en español) o null si todo es válido. */
export function validarAltaAdmin(d: {
  email: string;
  password: string;
  confirmacion: string;
}): string | null {
  if (!esquemaCorreo.safeParse(d.email).success) return 'El correo no es válido (máx. 200 caracteres).';
  if (d.password !== d.confirmacion) return 'Las contraseñas no coinciden.';
  return validarFortaleza(d.password);
}
