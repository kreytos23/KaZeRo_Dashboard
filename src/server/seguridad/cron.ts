import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

const digesto = (t: string) => createHash('sha256').update(t).digest();

/**
 * Vercel Cron manda `Authorization: Bearer $CRON_SECRET`. Se comparan los SHA-256 (siempre del mismo largo)
 * en tiempo constante con `timingSafeEqual`. Sin secreto configurado, vacío o de menos de 32 caracteres,
 * no entra nadie (falla cerrado). Un secreto demasiado corto da 401 siempre: por eso se deja un aviso
 * en el log (sin el valor) para no depurar a ciegas el cron.
 */
export function autorizarCron(req: Request, secreto = process.env.CRON_SECRET): boolean {
  if (!secreto) return false;
  if (secreto.length < 32) {
    console.warn('CRON_SECRET es demasiado corto (mínimo 32 caracteres): el cron será rechazado.');
    return false;
  }
  const dado = req.headers.get('authorization') ?? '';
  return timingSafeEqual(digesto(dado), digesto(`Bearer ${secreto}`));
}
