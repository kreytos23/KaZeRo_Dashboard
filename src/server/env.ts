import 'server-only';
import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'DATABASE_URL debe ser una URL postgresql://' }),
  KAZERO_TOTP_KEY: z
    .string({ error: 'Falta KAZERO_TOTP_KEY' })
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'KAZERO_TOTP_KEY debe ser 32 bytes en base64'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Entorno = z.infer<typeof esquema>;
let cache: Entorno | undefined;

export function env(): Entorno {
  if (cache) return cache;
  const r = esquema.safeParse(process.env);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración de entorno inválida → ${detalle}`);
  }
  cache = r.data;
  return cache;
}
