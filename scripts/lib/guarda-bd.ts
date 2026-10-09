import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

export class GuardaBdError extends Error {
  override name = 'GuardaBdError';
}

/**
 * `new URL` lanza un TypeError que lleva la cadena completa en `input` (con la contraseña).
 * Lo traducimos a un GuardaBdError que no contiene el valor ni encadena el error original.
 */
function parsearUrl(url: string, etiqueta = 'URL de base de datos'): URL {
  try {
    return new URL(url);
  } catch {
    throw new GuardaBdError(`${etiqueta} no es una URL válida (no se muestra por seguridad).`);
  }
}

export function describirUrl(url: string, etiqueta?: string) {
  const u = parsearUrl(url, etiqueta);
  return {
    usuario: decodeURIComponent(u.username),
    host: u.hostname,
    baseDatos: u.pathname.replace(/^\//, ''),
  };
}

export function hostNormalizado(urlOHost: string, etiqueta?: string): string {
  const host = urlOHost.includes('://') ? parsearUrl(urlOHost, etiqueta).hostname : urlOHost;
  return host.replace(/-pooler(?=\.)/, '');
}

export interface OpcionesGuarda {
  variable: string;
  efectiva?: string;
  delArchivo?: string;
  hostProduccion?: string;
  confirmacion?: string;
}

/**
 * Las variables de la terminal ganan sobre .env.local: una DATABASE_URL exportada semanas atrás
 * hace que un script apunte a producción sin avisar (lecciones §3). Esta guarda lo convierte en error.
 */
export function verificarDestino(o: OpcionesGuarda) {
  if (!o.efectiva) throw new GuardaBdError(`${o.variable} no está definida.`);
  const destino = describirUrl(o.efectiva, o.variable);
  const confirmado = o.confirmacion === 'confirmo';

  if (o.delArchivo !== undefined && o.delArchivo !== o.efectiva && !confirmado) {
    throw new GuardaBdError(
      `La ${o.variable} de tu terminal (host ${destino.host}) no coincide con la de .env.local ` +
        `(host ${describirUrl(o.delArchivo, `${o.variable} de .env.local`).host}). ` +
        `Probablemente quedó exportada de una sesión anterior. ` +
        `Quítala con "unset ${o.variable}" (PowerShell: Remove-Item Env:${o.variable}) o, si de verdad ` +
        `quieres otra base, repite con KAZERO_OTRA_BD=confirmo.`,
    );
  }

  const esProduccion =
    !!o.hostProduccion &&
    hostNormalizado(destino.host) === hostNormalizado(o.hostProduccion, 'KAZERO_HOST_PROD');
  if (esProduccion && !confirmado) {
    throw new GuardaBdError(
      `Destino = PRODUCCIÓN (${destino.host}). Repite con KAZERO_OTRA_BD=confirmo si es intencional.`,
    );
  }
  return { ...destino, esProduccion };
}

/**
 * Igual que la comprobación terminal-vs-.env.local de verificarDestino, pero para secretos que no son
 * URLs (p. ej. KAZERO_TOTP_KEY). Nunca incluye los valores en el mensaje.
 */
export function verificarSecreto(o: {
  variable: string;
  efectiva?: string;
  delArchivo?: string;
  confirmacion?: string;
}) {
  if (o.efectiva === undefined || o.delArchivo === undefined) return;
  if (o.efectiva !== o.delArchivo && o.confirmacion !== 'confirmo') {
    throw new GuardaBdError(
      `La ${o.variable} de tu terminal no coincide con la de .env.local (no se muestran los valores). ` +
        `Probablemente quedó exportada de una sesión anterior. Quítala con "unset ${o.variable}" ` +
        `(PowerShell: Remove-Item Env:${o.variable}) o, si es intencional, repite con KAZERO_OTRA_BD=confirmo.`,
    );
  }
}

/** Punto de entrada de todo script que escribe en BD: imprime el destino y lo valida. */
export function prepararDestino(variable: string, accion: string, rutaEnv = '.env.local'): string {
  const archivo = existsSync(rutaEnv) ? parse(readFileSync(rutaEnv)) : {};
  const efectiva = process.env[variable] ?? archivo[variable];
  const hostProduccion = process.env.KAZERO_HOST_PROD || archivo.KAZERO_HOST_PROD;
  // En CI no hay .env.local: sin KAZERO_HOST_PROD la guarda no distinguiría producción (fail-open).
  if (process.env.CI === 'true' && !hostProduccion) {
    throw new GuardaBdError(
      'KAZERO_HOST_PROD no está definida en CI: la guarda no puede reconocer producción.',
    );
  }
  const destino = verificarDestino({
    variable,
    efectiva,
    delArchivo: archivo[variable],
    hostProduccion,
    confirmacion: process.env.KAZERO_OTRA_BD,
  });
  console.log(`[guarda-bd] Acción: ${accion}`);
  console.log(
    `[guarda-bd] Destino: ${destino.usuario}@${destino.host}/${destino.baseDatos}` +
      (destino.esProduccion ? '   <<< PRODUCCIÓN >>>' : ''),
  );
  return efectiva!;
}
