import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

export class GuardaBdError extends Error {
  override name = 'GuardaBdError';
}

export function describirUrl(url: string) {
  const u = new URL(url);
  return {
    usuario: decodeURIComponent(u.username),
    host: u.hostname,
    baseDatos: u.pathname.replace(/^\//, ''),
  };
}

export function hostNormalizado(urlOHost: string): string {
  const host = urlOHost.includes('://') ? new URL(urlOHost).hostname : urlOHost;
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
  const destino = describirUrl(o.efectiva);
  const confirmado = o.confirmacion === 'confirmo';

  if (o.delArchivo !== undefined && o.delArchivo !== o.efectiva && !confirmado) {
    throw new GuardaBdError(
      `La ${o.variable} de tu terminal (host ${destino.host}) no coincide con la de .env.local ` +
        `(host ${describirUrl(o.delArchivo).host}). Probablemente quedó exportada de una sesión anterior. ` +
        `Quítala con "unset ${o.variable}" (PowerShell: Remove-Item Env:${o.variable}) o, si de verdad ` +
        `quieres otra base, repite con KAZERO_OTRA_BD=confirmo.`,
    );
  }

  const esProduccion =
    !!o.hostProduccion && hostNormalizado(destino.host) === hostNormalizado(o.hostProduccion);
  if (esProduccion && !confirmado) {
    throw new GuardaBdError(
      `Destino = PRODUCCIÓN (${destino.host}). Repite con KAZERO_OTRA_BD=confirmo si es intencional.`,
    );
  }
  return { ...destino, esProduccion };
}

/** Punto de entrada de todo script que escribe en BD: imprime el destino y lo valida. */
export function prepararDestino(variable: string, accion: string, rutaEnv = '.env.local'): string {
  const archivo = existsSync(rutaEnv) ? parse(readFileSync(rutaEnv)) : {};
  const efectiva = process.env[variable] ?? archivo[variable];
  const destino = verificarDestino({
    variable,
    efectiva,
    delArchivo: archivo[variable],
    hostProduccion: process.env.KAZERO_HOST_PROD ?? archivo.KAZERO_HOST_PROD,
    confirmacion: process.env.KAZERO_OTRA_BD,
  });
  console.log(`[guarda-bd] Acción: ${accion}`);
  console.log(
    `[guarda-bd] Destino: ${destino.usuario}@${destino.host}/${destino.baseDatos}` +
      (destino.esProduccion ? '   <<< PRODUCCIÓN >>>' : ''),
  );
  return efectiva!;
}
