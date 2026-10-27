import { conDbLectura } from '@/db/client';
import { uuidOpcional } from '@/server/acciones';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { pdfDeudores } from '@/server/pdf/generar';
import { nombreArchivoDeudores } from '@/server/pdf/nombres';
import { respuestaPdf } from '@/server/pdf/respuesta';
import { reporteDeudores } from '@/server/reportes/deudores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const s = await sesionDeApi();
  if (!s) return Response.json({ error: 'no_autenticado' }, { status: 401, headers: SIN_CACHE });
  const vendedorId = uuidOpcional(new URL(req.url).searchParams.get('vendedor')); // inválido → sin filtro
  const r = await conDbLectura((db) => reporteDeudores(db, { vendedorId: vendedorId ?? undefined }));
  const nombre = vendedorId ? (r.grupos[0]?.vendedorNombre ?? null) : null;
  const bytes = await pdfDeudores(r, nombre);
  return respuestaPdf(bytes, nombreArchivoDeudores(r.fecha, nombre));
}
