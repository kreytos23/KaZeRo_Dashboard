import 'server-only';
import { headers } from 'next/headers';

export async function datosRed(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  return { ip, userAgent: h.get('user-agent')?.slice(0, 300) ?? null };
}
