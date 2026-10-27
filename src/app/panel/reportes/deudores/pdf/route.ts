import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { pdfDeudores } from '@/server/pdf/generar';
import { nombreArchivoDeudores } from '@/server/pdf/nombres';
import { reporteDeudores } from '@/server/reportes/deudores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const s = await sesionDeApi();
  if (!s) return Response.json({ error: 'no_autenticado' }, { status: 401, headers: SIN_CACHE });
  const v = z.uuid().safeParse(new URL(req.url).searchParams.get('vendedor'));
  const vendedorId = v.success ? v.data : null; // inválido → sin filtro
  const r = await conDbLectura((db) => reporteDeudores(db, { vendedorId: vendedorId ?? undefined }));
  const nombre = vendedorId ? (r.grupos[0]?.vendedorNombre ?? null) : null;
  const bytes = await pdfDeudores(r, nombre);
  return new Response(bytes as BodyInit, {
    headers: {
      ...SIN_CACHE,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombreArchivoDeudores(r.fecha, nombre)}"`,
    },
  });
}
